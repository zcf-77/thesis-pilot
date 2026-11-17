import type {
  DocumentOfficeSourceRead,
  DocumentRead,
  JobDetail,
  OfficeImportInput,
  OfficeImportLoss,
  OfficeImportRead,
  OfficeImportReceipt,
  OfficeImportResult,
} from "./contracts/api.generated.ts";
import { convertLegacyContent, type DocsSnapshotContent } from "./docsContent.ts";
import { isDocsContent } from "./documentContent.ts";
import { ApiError } from "./errors.ts";
import { checkOfficeConfirm } from "./httpOfficeImports.ts";
import type { MockDocuments } from "./mockDocuments.ts";
import type { createMockJobs } from "./mockJobs.ts";
import type { DocumentSourceService, MaterialService, OfficeImportService } from "./types.ts";
import { pageQuery, parseDto, requireIdempotencyKey, requireUuid } from "./validation.ts";

type MockJobs = ReturnType<typeof createMockJobs>;
interface Row {
  id: string;
  projectId: string;
  filename: string;
  sha256: string;
  materialId: string;
  originalId: string;
  snapshot: DocsSnapshotContent;
  losses: OfficeImportLoss[];
}
interface Link {
  documentId: string;
  version: number;
  row: Row;
  commandId: string;
  digest: string;
  mode: OfficeImportReceipt["mode"];
  createdAt: string;
}
type Block = { type: string; inlines?: { type: string; text?: string }[] };
const blocksOf = (snapshot: DocsSnapshotContent) => (snapshot.model.sections as unknown as { blocks?: Block[] }[]).flatMap((section) => section.blocks ?? []);
const characters = (snapshot: DocsSnapshotContent) =>
  blocksOf(snapshot).reduce(
    (total, block) => total + (block.inlines ?? []).reduce((sum, inline) => sum + (inline.type === "run" ? Array.from(inline.text ?? "").length : 0), 0),
    0,
  );
const MOCK_LOSS: OfficeImportLoss = {
  kind: "mock_placeholder",
  path: "word/document.xml",
  label: "本地模拟服务不读取 Word 内容，正文为占位文字",
  action: "noted",
  detail: null,
  node_id: null,
};

export interface MockOfficeImports {
  service: OfficeImportService;
  /** 保留原件导出所用的导入基线版本（该版本或更早最近一次导入）。 */
  baseline: (projectId: string, documentId: string, version: number) => number | undefined;
}

/** 同契约模拟：不解析 DOCX，只以文件名生成标注为模拟的占位正文；确认才写正式稿。 */
export function createMockOfficeImports(
  before: (signal?: AbortSignal) => Promise<void>,
  requireProject: (id: string) => unknown,
  documents: MockDocuments,
  documentSources: DocumentSourceService,
  materials: MaterialService,
  jobs: MockJobs,
): MockOfficeImports {
  const filenames = new Map<string, string>();
  const rows = new Map<string, Row>();
  const links: Link[] = [];

  jobs.registerFixed("office_import", (job): OfficeImportResult => {
    const input = job.input_snapshot as OfficeImportInput;
    const filename = filenames.get(input.original_id) ?? "论文.docx";
    const stem = filename.replace(/\.docx$/i, "") || "论文";
    const importId = crypto.randomUUID();
    const snapshot = convertLegacyContent(
      {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1, chapterId: `${importId}-h1` }, content: [{ type: "text", text: stem }] },
          { type: "paragraph", content: [{ type: "text", text: "（本地模拟服务占位正文，未读取 Word 原件内容。）" }] },
        ],
      },
      importId,
    );
    const row: Row = {
      id: importId,
      projectId: job.project_id,
      filename,
      sha256: input.original_sha256,
      materialId: input.material_id,
      originalId: input.original_id,
      snapshot,
      losses: [MOCK_LOSS],
    };
    rows.set(job.id, row);
    return {
      schema_version: 1,
      kind: "office_import",
      job_id: job.id,
      project_id: job.project_id,
      import_id: importId,
      original_sha256: input.original_sha256,
      block_count: blocksOf(snapshot).length,
      chapter_count: snapshot.chapters?.length ?? 0,
      object_count: 0,
      loss_count: row.losses.length,
      model_used: false,
      writes_performed: false,
    };
  });

  async function current(projectId: string): Promise<DocumentRead | undefined> {
    return documents.current(projectId).catch((cause: unknown) => {
      if (cause instanceof ApiError && cause.code === "DOCUMENT_NOT_FOUND") return undefined;
      throw cause;
    });
  }
  async function appendBlock(projectId: string, document: DocumentRead): Promise<string | null> {
    if (!isDocsContent(document.content)) return "当前正文仍是旧版结构，请先在写作页升级正文结构，再作为新版本导入。";
    const legacy = await documentSources.current(projectId, document.id, document.version).then(
      () => true,
      () => false,
    );
    return legacy ? "当前正文来自旧版原件导入并受来源保护，不能整体替换。" : null;
  }
  async function view(job: JobDetail): Promise<OfficeImportRead> {
    const input = job.input_snapshot as OfficeImportInput;
    const row = job.status === "succeeded" ? rows.get(job.id) : undefined;
    let preview: OfficeImportRead["preview"] = null;
    if (row) {
      const document = await current(job.project_id);
      const blocked = document ? await appendBlock(job.project_id, document) : null;
      preview = {
        import_id: row.id,
        filename: row.filename,
        original_sha256: row.sha256,
        converter: "thesispilot-mock-office-1",
        block_count: blocksOf(row.snapshot).length,
        paragraph_count: blocksOf(row.snapshot).filter((block) => block.type === "paragraph").length,
        table_count: 0,
        image_count: 0,
        text_characters: characters(row.snapshot),
        chapters: (row.snapshot.chapters ?? []).map((item) => ({ id: item.id, level: item.level, title: item.title })),
        chapters_truncated: false,
        objects: [],
        losses: structuredClone(row.losses),
        existing_document_id: document?.id ?? null,
        existing_version: document?.version ?? null,
        can_create: !document,
        can_append: !!document && blocked === null,
        append_blocked_reason: blocked,
      };
    }
    return parseDto("OfficeImportRead", {
      job_id: job.id,
      project_id: job.project_id,
      status: job.status,
      attempt: job.attempt,
      material_id: input.material_id,
      original_id: input.original_id,
      original_sha256: input.original_sha256,
      source_job_id: job.source_job_id ?? null,
      error_code: job.error_code,
      preview,
      created_at: job.created_at,
      updated_at: job.updated_at,
    });
  }
  async function read(projectId: string, jobId: string): Promise<JobDetail> {
    const job = await jobs.get(jobId, undefined, projectId).catch((cause: unknown) => {
      throw cause instanceof ApiError && cause.code === "JOB_NOT_FOUND" ? new ApiError("OFFICE_IMPORT_NOT_FOUND", { status: 404 }) : cause;
    });
    if (job.kind !== "office_import") throw new ApiError("OFFICE_IMPORT_NOT_FOUND", { status: 404 });
    return job;
  }
  const receipt = (link: Link): OfficeImportReceipt => ({
    command_id: link.commandId,
    import_id: link.row.id,
    document_id: link.documentId,
    document_version: link.version,
    mode: link.mode,
  });

  const service: OfficeImportService = {
    async create(projectId, input, key, signal) {
      await before(signal);
      requireIdempotencyKey(key);
      requireProject(requireUuid(projectId));
      const data = parseDto("OfficeImportCreate", input, true);
      const original = await materials.original(projectId, data.material_id, data.original_id, signal);
      if (original.file_type !== "docx") throw new ApiError("OFFICE_IMPORT_UNSUPPORTED_TYPE", { status: 422 });
      filenames.set(original.id, original.filename);
      const snapshot: OfficeImportInput = {
        schema_version: 1,
        material_id: original.material_id.toLowerCase(),
        original_id: original.id.toLowerCase(),
        original_sha256: original.sha256,
      };
      const job = jobs.enqueueFixed({ projectId, kind: "office_import", snapshot, configuration: null }, key);
      return view(await read(projectId, job.id));
    },
    async list(projectId, query, signal) {
      await before(signal);
      requireProject(requireUuid(projectId));
      const { limit, offset } = pageQuery(query);
      const all = (await jobs.list({ project_id: projectId, kind: "office_import", limit: 100, offset: 0 })).items;
      const items = await Promise.all(all.slice(offset, offset + limit).map(async (item) => view(await read(projectId, item.id))));
      return parseDto("OfficeImportPage", { items, total: all.length, limit, offset });
    },
    async get(projectId, jobId, signal) {
      await before(signal);
      return view(await read(projectId, jobId));
    },
    async cancel(projectId, jobId, signal) {
      await read(projectId, jobId);
      await jobs.cancel(jobId, signal, projectId);
      return view(await read(projectId, jobId));
    },
    async retry(projectId, jobId, key, signal) {
      await read(projectId, jobId);
      const job = await jobs.retry(jobId, key, signal, projectId);
      return view(await read(projectId, job.id));
    },
    async confirm(projectId, jobId, input, signal) {
      await before(signal);
      const data = checkOfficeConfirm(input);
      const digest = JSON.stringify([projectId.toLowerCase(), jobId.toLowerCase(), data.mode, data.expected_version ?? null]);
      const replay = links.find((item) => item.commandId === data.command_id);
      if (replay) {
        if (replay.digest !== digest) throw new ApiError("OFFICE_IMPORT_COMMAND_CONFLICT", { status: 409 });
        return receipt(replay);
      }
      const job = await read(projectId, jobId);
      const row = rows.get(job.id);
      if (job.status !== "succeeded" || !row) throw new ApiError("OFFICE_IMPORT_NOT_READY", { status: 409 });
      const content = { schema_version: 2 as const, json: structuredClone(row.snapshot) };
      let document: DocumentRead;
      if (data.mode === "create") {
        document = documents.createOfficeImport(projectId, content);
      } else {
        const existing = await current(projectId);
        if (!existing) throw new ApiError("DOCUMENT_NOT_FOUND", { status: 404 });
        if (await appendBlock(projectId, existing)) throw new ApiError("OFFICE_IMPORT_APPEND_BLOCKED", { status: 409 });
        document = documents.appendRevisionVersion(projectId, existing.id, data.expected_version as number, content, "office_import");
      }
      const link: Link = {
        documentId: document.id,
        version: document.version,
        row,
        commandId: data.command_id,
        digest,
        mode: data.mode,
        createdAt: document.updated_at,
      };
      links.push(link);
      return receipt(link);
    },
    async source(projectId, documentId, version, signal) {
      await before(signal);
      const document = documents.revisionCurrent(projectId.toLowerCase(), requireUuid(documentId).toLowerCase());
      const number = version ?? document.version;
      documents.revisionVersion(projectId.toLowerCase(), document.id, number);
      const link = latest(document.id, number);
      if (!link) throw new ApiError("OFFICE_IMPORT_SOURCE_NOT_FOUND", { status: 404 });
      return parseDto("DocumentOfficeSourceRead", {
        document_id: document.id,
        document_version: link.version,
        import_id: link.row.id,
        material_id: link.row.materialId,
        original_id: link.row.originalId,
        original_sha256: link.row.sha256,
        filename: link.row.filename,
        imported_at: link.createdAt,
      } satisfies DocumentOfficeSourceRead);
    },
  };
  function latest(documentId: string, version: number): Link | undefined {
    return links.filter((item) => item.documentId === documentId && item.version <= version).sort((a, b) => b.version - a.version)[0];
  }
  return { service, baseline: (_projectId, documentId, version) => latest(documentId.toLowerCase(), version)?.version };
}

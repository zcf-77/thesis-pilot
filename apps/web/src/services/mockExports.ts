import type {
  ChangeRecordInput,
  ChangeRecordResult,
  DocumentExportInput,
  DocumentExportResult,
  DocumentVersionRead,
  ExportFileRead,
  ExportRead,
  JobDetail,
} from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { MockDocuments } from "./mockDocuments.ts";
import type { createMockJobs } from "./mockJobs.ts";
import type { ExportService } from "./types.ts";
import { pageQuery, parseDto, requireIdempotencyKey, requireUuid } from "./validation.ts";

type MockJobs = ReturnType<typeof createMockJobs>;
type Node = { type: string; text?: string; attrs?: Record<string, unknown>; content?: Node[]; marks?: { type: string }[] };
const CONTENT_TYPES = { html: "text/html; charset=utf-8", txt: "text/plain; charset=utf-8", markdown: "text/markdown; charset=utf-8" } as const;
const EXTENSIONS = { html: "html", txt: "txt", markdown: "md" } as const;
const SOURCES: Record<DocumentVersionRead["source"], string> = {
  blank: "新建空白稿",
  local_import: "导入正文",
  manual_edit: "手动保存",
  ai_adoption: "采纳候选",
  adoption_undo: "撤销采纳",
  version_revert: "恢复历史版本",
};
const STATEMENT = "本说明依据系统中的正文版本与学生的采纳决定生成，只记录学生的修改与处理，不代表导师已审阅或认可。";

const SHA256_K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74,
  0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d,
  0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e,
  0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Synchronous SHA-256 so the in-memory queue can finish a job inside one poll. */
export function sha256Sync(bytes: Uint8Array): string {
  const k = SHA256_K;
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const length = bytes.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (length * 8) >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh! + (rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25)) + ((e! & f!) ^ (~e! & g!)) + k[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22)) + ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>> 0;
      [hh, g, f, e, d, c, b, a] = [g, f, e, (d! + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, hh].forEach((value, i) => (h[i] = (h[i]! + value!) >>> 0));
  }
  return [...h].map((value) => value.toString(16).padStart(8, "0")).join("");
}

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textOf = (node: Node): string =>
  node.type === "text" ? (node.text ?? "") : node.type === "hardBreak" ? "\n" : (node.content ?? []).map(textOf).join("");

function renderDocument(root: Node, version: number, format: keyof typeof CONTENT_TYPES): string {
  const lines: string[] = [];
  const inline = (node: Node) =>
    (node.content ?? [])
      .map((child) => {
        const value = format === "html" ? escape(textOf(child)) : textOf(child);
        return format === "html" && child.marks?.some((mark) => mark.type === "aiLock") ? `<span class="tp-locked" data-locked="true">${value}</span>` : value;
      })
      .join("");
  const walk = (node: Node, prefix = "") => {
    if (node.type === "heading") {
      const level = Number(node.attrs?.level ?? 1);
      lines.push(format === "html" ? `<h${level}>${inline(node)}</h${level}>` : format === "markdown" ? `${"#".repeat(level)} ${inline(node)}` : inline(node));
    } else if (node.type === "paragraph") lines.push(format === "html" ? `<p>${inline(node)}</p>` : prefix + inline(node));
    else if (node.type === "listItem") (node.content ?? []).forEach((child) => walk(child, prefix || "- "));
    else if (node.type === "tableRow") lines.push((node.content ?? []).map((cell) => textOf(cell)).join(format === "txt" ? "\t" : " | "));
    else (node.content ?? []).forEach((child) => walk(child, prefix));
  };
  walk(root);
  const body = lines.join(format === "html" ? "\n" : "\n\n");
  if (format === "html")
    return `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<title>正文 v${version}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
  return (format === "markdown" ? `<!-- ThesisPilot 正文 v${version} -->\n\n` : "") + body + "\n";
}

export function createMockExports(
  before: (signal?: AbortSignal) => Promise<void>,
  requireProject: (id: string) => unknown,
  documents: MockDocuments,
  jobs: MockJobs,
): ExportService {
  const files = new Map<string, { file: ExportFileRead; text: string }>();

  function store(job: JobDetail, text: string, filename: string, format: keyof typeof CONTENT_TYPES) {
    const data = new TextEncoder().encode(text);
    if (data.byteLength > 8 * 1024 * 1024) throw new ApiError("EXPORT_TOO_LARGE");
    const file: ExportFileRead = {
      id: crypto.randomUUID(),
      filename,
      content_type: CONTENT_TYPES[format],
      sha256: sha256Sync(data),
      byte_size: data.byteLength,
      created_at: job.updated_at,
    };
    files.set(job.id, { file, text });
    return file;
  }
  function common(job: JobDetail, file: ExportFileRead, documentId: string) {
    return {
      schema_version: 1 as const,
      job_id: job.id,
      project_id: job.project_id,
      document_id: documentId,
      file_id: file.id,
      filename: file.filename,
      content_type: file.content_type as DocumentExportResult["content_type"],
      sha256: file.sha256,
      byte_size: file.byte_size,
      model_used: false as const,
      writes_performed: false as const,
    };
  }
  function digest(value: unknown) {
    return sha256Sync(new TextEncoder().encode(JSON.stringify(value)));
  }
  function documentFacts(projectId: string, input: DocumentExportInput) {
    return documents.revisionVersion(projectId, input.document_id, input.document_version).content.json;
  }
  function changeFacts(projectId: string, input: ChangeRecordInput) {
    const versions: DocumentVersionRead[] = [];
    for (let version = input.from_version; version <= input.to_version; version++)
      versions.push(documents.revisionVersion(projectId, input.document_id, version));
    return versions.map((item) => ({ version: item.version, source: item.source, created_at: item.created_at }));
  }
  function checkSource(job: JobDetail, facts: unknown) {
    const configuration = job.configuration;
    if (!configuration || !("renderer_version" in configuration) || configuration.source_sha256 !== digest(facts)) throw new ApiError("EXPORT_SOURCE_CHANGED");
  }

  jobs.registerFixed("document_export", (job, _attempt): DocumentExportResult => {
    const input = job.input_snapshot as DocumentExportInput;
    const content = documentFacts(job.project_id, input);
    checkSource(job, content);
    const file = store(
      job,
      renderDocument(content as Node, input.document_version, input.format),
      `论文正文-v${input.document_version}.${EXTENSIONS[input.format]}`,
      input.format,
    );
    return { ...common(job, file, input.document_id), kind: "document_export", document_version: input.document_version, format: input.format };
  });
  jobs.registerFixed("change_record", (job, _attempt): ChangeRecordResult => {
    const input = job.input_snapshot as ChangeRecordInput;
    const facts = changeFacts(job.project_id, input);
    checkSource(job, facts);
    const title = `修改说明 · 正文 v${input.from_version}–v${input.to_version}`;
    const rows = facts.map((fact) => `v${fact.version} · ${SOURCES[fact.source]} · ${fact.created_at}`);
    const text =
      input.format === "html"
        ? `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<title>${title}</title>\n</head>\n<body>\n<h1>${title}</h1>\n<p>${STATEMENT}</p>\n${rows.map((row) => `<h2>${escape(row)}</h2>`).join("\n")}\n</body>\n</html>\n`
        : `# ${title}\n\n> ${STATEMENT}\n\n${rows.map((row) => `## ${row}`).join("\n\n")}\n`;
    const file = store(job, text, `修改说明-v${input.from_version}-v${input.to_version}.${EXTENSIONS[input.format]}`, input.format);
    return {
      ...common(job, file, input.document_id),
      kind: "change_record",
      from_version: input.from_version,
      to_version: input.to_version,
      format: input.format,
      version_count: facts.length,
    };
  });

  async function read(projectId: string, jobId: string): Promise<ExportRead> {
    const job = await jobs.get(jobId, undefined, projectId).catch((cause: unknown) => {
      throw cause instanceof ApiError && cause.code === "JOB_NOT_FOUND" ? new ApiError("EXPORT_NOT_FOUND", { status: 404 }) : cause;
    });
    if (job.kind !== "document_export" && job.kind !== "change_record") throw new ApiError("EXPORT_NOT_FOUND", { status: 404 });
    return view(job);
  }
  function view(
    job: Pick<JobDetail, "id" | "project_id" | "kind" | "status" | "attempt" | "input_snapshot" | "source_job_id" | "error_code" | "created_at" | "updated_at">,
  ): ExportRead {
    const input = job.input_snapshot as DocumentExportInput | ChangeRecordInput;
    const change = "from_version" in input;
    return parseDto("ExportRead", {
      job_id: job.id,
      project_id: job.project_id,
      kind: job.kind,
      status: job.status,
      attempt: job.attempt,
      format: input.format,
      document_id: input.document_id,
      document_version: change ? input.to_version : input.document_version,
      from_version: change ? input.from_version : null,
      source_job_id: job.source_job_id ?? null,
      error_code: job.error_code,
      file: job.status === "succeeded" ? (files.get(job.id)?.file ?? null) : null,
      created_at: job.created_at,
      updated_at: job.updated_at,
    });
  }
  function enqueue(projectId: string, snapshot: DocumentExportInput | ChangeRecordInput, key: string) {
    const facts = "from_version" in snapshot ? changeFacts(projectId, snapshot) : documentFacts(projectId, snapshot);
    const kind = "from_version" in snapshot ? ("change_record" as const) : ("document_export" as const);
    const configuration = { schema_version: 1 as const, renderer_version: "thesispilot-export-1" as const, source_sha256: digest(facts) };
    return view(jobs.enqueueFixed({ projectId, kind, snapshot, configuration }, key));
  }

  return {
    async list(projectId, query, signal) {
      await before(signal);
      requireProject(requireUuid(projectId));
      const { limit, offset } = pageQuery(query);
      const all = [...(await jobs.list({ project_id: projectId, limit: 100, offset: 0 })).items].filter(
        (job) => job.kind === "document_export" || job.kind === "change_record",
      );
      return parseDto("ExportPage", { items: all.slice(offset, offset + limit).map(view), total: all.length, limit, offset });
    },
    async get(projectId, jobId, signal) {
      await before(signal);
      return read(projectId, jobId);
    },
    async exportDocument(projectId, input, key, signal) {
      await before(signal);
      requireIdempotencyKey(key);
      const data = parseDto("DocumentExportCreate", input, true);
      documents.revisionCurrent(projectId, data.document_id);
      return enqueue(
        projectId,
        { schema_version: 1, document_id: data.document_id.toLowerCase(), document_version: data.document_version, format: data.format },
        key,
      );
    },
    async changeRecord(projectId, input, key, signal) {
      await before(signal);
      requireIdempotencyKey(key);
      const data = parseDto("ChangeRecordCreate", input, true);
      const current = documents.revisionCurrent(projectId, data.document_id);
      const to = data.to_version ?? current.version;
      if (data.from_version > to) throw new ApiError("EXPORT_RANGE_INVALID", { status: 422 });
      if (to - data.from_version + 1 > 200) throw new ApiError("EXPORT_RANGE_TOO_LARGE", { status: 422 });
      return enqueue(
        projectId,
        { schema_version: 1, document_id: data.document_id.toLowerCase(), from_version: data.from_version, to_version: to, format: data.format },
        key,
      );
    },
    async cancel(projectId, jobId, signal) {
      await read(projectId, jobId);
      await jobs.cancel(jobId, signal, projectId);
      return read(projectId, jobId);
    },
    async retry(projectId, jobId, key, signal) {
      await read(projectId, jobId);
      const job = await jobs.retry(jobId, key, signal, projectId);
      return read(projectId, job.id);
    },
    async download(projectId, jobId, signal) {
      await before(signal);
      const value = await read(projectId, jobId);
      const stored = files.get(jobId.toLowerCase());
      if (value.status !== "succeeded" || !stored) throw new ApiError("EXPORT_FILE_NOT_READY", { status: 409 });
      return { blob: new Blob([stored.text], { type: stored.file.content_type }), filename: stored.file.filename };
    },
  };
}

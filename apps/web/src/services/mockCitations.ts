import type { CitationListRead } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import type { CitationService, DocumentService } from "./types.ts";
import { pageQuery, parseDto, requireUuid } from "./validation.ts";

const MARKER = "tp-cite-mark:";
const REFERENCE = "tp-cite-ref:";

/**
 * In-memory adapter with the HTTP contract. The mock literature service never invents
 * bibliographic records, so no project entry exists here and no candidate can be created;
 * the citation list is derived from the stored snapshot's managed protections.
 */
export function createMockCitations(
  before: (signal?: AbortSignal) => Promise<void>,
  requireProject: (id: string) => unknown,
  documents: DocumentService,
): CitationService {
  async function stored(projectId: string, documentId: string, version?: number, signal?: AbortSignal) {
    await before(signal);
    requireProject(requireUuid(projectId));
    const current = await documents.current(projectId, signal);
    if (current.id !== requireUuid(documentId).toLowerCase()) throw new ApiError("DOCUMENT_NOT_FOUND", { status: 404 });
    if (version === undefined || version === current.version) return { version: current.version, content: current.content };
    const read = await documents.version(projectId, documentId, version, signal);
    return { version: read.version, content: read.content };
  }
  const missing = () => new ApiError("CITATION_NOT_FOUND", { status: 404 });
  return {
    async list(projectId, documentId, version, signal) {
      const { version: number, content } = await stored(projectId, documentId, version, signal);
      const base = { document_id: documentId.toLowerCase(), document_version: number, schema_version: content.schema_version };
      if (content.schema_version !== 2) return parseDto("CitationListRead", { ...base, references_heading: null, consistent: true, items: [] });
      const managed = (content.json.protections ?? []).filter((item) => item.kind === "citation" && item.binding && item.id.startsWith(MARKER));
      const references = new Map(
        (content.json.protections ?? [])
          .filter((item) => item.kind === "citation" && item.id.startsWith(REFERENCE))
          .map((item) => [item.binding, item.anchor.node]),
      );
      const order: string[] = [];
      managed.forEach((item) => {
        if (!order.includes(item.binding!)) order.push(item.binding!);
      });
      const value: CitationListRead = {
        ...base,
        references_heading: null,
        consistent: true,
        items: order.map((binding, index) => ({
          entry_id: binding,
          number: index + 1,
          title: "",
          removed: true,
          reference_node: references.get(binding) ?? null,
          reference_text: null,
          markers: managed
            .filter((item) => item.binding === binding)
            .map((item) => ({ protection_id: item.id, node: item.anchor.node, start: item.anchor.start ?? 0, end: item.anchor.end ?? 0 })),
        })),
      };
      return parseDto("CitationListRead", value);
    },
    async create(projectId, documentId, input, signal) {
      parseDto("CitationCreate", input, true);
      const { content } = await stored(projectId, documentId, undefined, signal);
      if (content.schema_version !== 2) throw new ApiError("CITATION_SCHEMA_UNSUPPORTED", { status: 409 });
      throw new ApiError("CITATION_ENTRY_NOT_FOUND", { status: 404 });
    },
    async candidates(projectId, documentId, query, signal) {
      const { limit, offset } = pageQuery(query);
      await stored(projectId, documentId, undefined, signal);
      return parseDto("CitationCandidatePage", { items: [], total: 0, limit, offset });
    },
    async get(projectId, documentId, _candidateId, signal) {
      await stored(projectId, documentId, undefined, signal);
      throw missing();
    },
    async apply(projectId, documentId, _candidateId, input, signal) {
      parseDto("CitationApply", input, true);
      await stored(projectId, documentId, undefined, signal);
      throw missing();
    },
    async reject(projectId, documentId, _candidateId, input, signal) {
      parseDto("CitationReject", input, true);
      await stored(projectId, documentId, undefined, signal);
      throw missing();
    },
    async undo(projectId, documentId, _candidateId, input, signal) {
      parseDto("CitationUndo", input, true);
      await stored(projectId, documentId, undefined, signal);
      throw missing();
    },
  };
}

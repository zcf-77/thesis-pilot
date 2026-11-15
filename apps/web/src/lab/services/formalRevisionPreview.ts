import type { RevisionPatch, RevisionSelection } from "../../services/contracts/api.generated.ts";
import { previewRewrite } from "../state/writingGuards.ts";

export function previewFormalRevision(selection: RevisionSelection): RevisionPatch[] {
  return [...selection.text.matchAll(/[^。！？!?]+[。！？!?]?/g)].flatMap((match, index) => {
    const before = match[0];
    const after = previewRewrite(before);
    const from = selection.from + match.index;
    return after === before ? [] : [{ id: `h${index + 1}`, from, to: from + before.length, before, after }];
  });
}

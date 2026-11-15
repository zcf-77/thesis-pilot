import { ApiError } from "./errors.ts";

export async function readBoundedResponse(response: Response, maximumBytes: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maximumBytes) throw new ApiError("INVALID_RESPONSE", { status: response.status });
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new ApiError("INVALID_RESPONSE", { status: response.status });
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_RESPONSE", { status: response.status });
  } finally {
    reader.releaseLock();
  }
}

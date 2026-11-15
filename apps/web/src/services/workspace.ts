import type { ProfileRead, ProfileUpdate, SessionRead } from "./contracts/api.generated.ts";
import { ApiError } from "./errors.ts";
import { createHttpRequest } from "./http.ts";
import { parseDto } from "./validation.ts";

export type WorkspaceSession = SessionRead;
export type WorkspaceProfile = ProfileRead;
export type WorkspaceProfileChanges = ProfileUpdate;

const request = createHttpRequest();
const sessionPath = "/workspace/session";

function verifySession(session: WorkspaceSession): WorkspaceSession {
  if (session.profile.id !== session.workspace_id) throw new ApiError("INVALID_RESPONSE");
  return session;
}

export const workspaceAccess = {
  async getSession(signal?: AbortSignal): Promise<WorkspaceSession> {
    return verifySession(await request(sessionPath, "SessionRead", "GET", undefined, signal));
  },
  async openSession(accessKey: string, signal?: AbortSignal): Promise<WorkspaceSession> {
    const input = parseDto("SessionCreate", { access_key: accessKey }, true);
    return verifySession(await request(sessionPath, "SessionRead", "POST", input, signal));
  },
  closeSession(signal?: AbortSignal): Promise<void> {
    return request(sessionPath, null, "DELETE", undefined, signal);
  },
  updateProfile(changes: WorkspaceProfileChanges, signal?: AbortSignal): Promise<WorkspaceProfile> {
    const input = parseDto("ProfileUpdate", { ...changes, display_name: changes.display_name.trim() }, true);
    return request("/workspace/profile", "ProfileRead", "PATCH", input, signal);
  },
};

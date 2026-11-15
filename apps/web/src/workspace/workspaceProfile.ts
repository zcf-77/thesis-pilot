import type { WorkspaceProfile, WorkspaceProfileChanges } from "../services/workspace.ts";

export type ProfileDraft = Omit<WorkspaceProfileChanges, "expected_version">;

export function profileDraft(profile: WorkspaceProfile): ProfileDraft {
  return {
    display_name: profile.display_name,
    notifications_enabled: profile.notifications_enabled,
    quiet_start: profile.quiet_start,
    quiet_end: profile.quiet_end,
    show_deferred: profile.show_deferred,
  };
}

export function mergeProfileDraft(original: ProfileDraft, draft: ProfileDraft, latest: WorkspaceProfile): ProfileDraft {
  return {
    display_name: draft.display_name === original.display_name ? latest.display_name : draft.display_name,
    notifications_enabled: draft.notifications_enabled === original.notifications_enabled ? latest.notifications_enabled : draft.notifications_enabled,
    quiet_start: draft.quiet_start === original.quiet_start ? latest.quiet_start : draft.quiet_start,
    quiet_end: draft.quiet_end === original.quiet_end ? latest.quiet_end : draft.quiet_end,
    show_deferred: draft.show_deferred === original.show_deferred ? latest.show_deferred : draft.show_deferred,
  };
}

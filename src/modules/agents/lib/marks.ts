import type { NotificationTone } from "./types";

// One mark per state, shared by notification titles and the tab badges so the
// two always say the same thing. Written as escapes to keep emoji out of the
// source; pictographs, so a state never reads as a tab colour.
export const TONE_MARK: Record<NotificationTone, string> = {
  permission: "\u{1F510}",
  question: "\u2753",
  idle: "\u{1F4AC}",
  attention: "\u{1F514}",
  "turn-end": "\u2705",
  subagent: "\u{1F9E9}",
  error: "\u274C",
  exited: "\u{1F3C1}",
};

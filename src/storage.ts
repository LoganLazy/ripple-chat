import type { ChatRoom, Message } from "./types";
export function readPreference<T>(
  key: string,
  fallback: T,
  valid: (value: unknown) => value is T,
): T {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "null");
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
export function writePreference(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
const object = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
const strings = (v: Record<string, unknown>, keys: string[]) =>
  keys.every((k) => typeof v[k] === "string");
function validMessage(v: unknown): v is Message {
  return (
    object(v) &&
    strings(v, ["id", "sender", "name", "text"]) &&
    typeof v.time === "number" &&
    Number.isFinite(v.time) &&
    [
      "url",
      "reply",
      "replyId",
      "filename",
      "mimetype",
      "localFile",
      "mediaUri",
    ].every((k) => v[k] === undefined || typeof v[k] === "string") &&
    (v.kind === undefined || ["text", "image", "file"].includes(String(v.kind)))
  );
}
export function validRooms(v: unknown): v is ChatRoom[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (r) =>
        object(r) &&
        strings(r, ["id", "name", "description", "color", "symbol"]) &&
        typeof r.unread === "number" &&
        Number.isFinite(r.unread) &&
        Array.isArray(r.members) &&
        r.members.every((m) => object(m) && strings(m, ["id", "name"])) &&
        Array.isArray(r.messages) &&
        r.messages.every(validMessage),
    )
  );
}
export const validPins = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((id) => typeof id === "string");
export const validTheme = (v: unknown): v is string =>
  v === "light" || v === "dark";

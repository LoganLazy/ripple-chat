// Only strip legacy quote fallbacks when the event has an actual reply relation.
export function messageBody(content: {
  body?: unknown;
  [key: string]: unknown;
}): string {
  const text = typeof content.body === "string" ? content.body : "";
  const relation = content["m.relates_to"] as
    { "m.in_reply_to"?: unknown } | undefined;
  if (!relation?.["m.in_reply_to"] || !text.startsWith("> ")) return text;
  const lines = text.split("\n");
  while (lines[0]?.startsWith("> ")) lines.shift();
  if (lines[0] === "") lines.shift();
  return lines.join("\n");
}
export class PendingMessageError extends Error {
  constructor(
    public eventId: string,
    cause: unknown,
  ) {
    super("消息未发送，已保留在会话中，请重试或取消。", { cause });
    this.name = "PendingMessageError";
  }
}

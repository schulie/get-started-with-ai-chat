/** Session data stays in memory. Never log stream bodies or provider error text. */
export type TaskPhase = "working" | "writing" | "completed" | "stopped" | "failed";

export interface ChatTask {
  id: string;
  phase: TaskPhase;
  startedAt: number;
  durationMs?: number;
  activity?: "searching" | "reading" | "preparing";
}

export class ChatStreamError extends Error {
  constructor(message = "The response was interrupted. Please retry.") {
    super(message);
    this.name = "ChatStreamError";
  }
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export async function readChatStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onContent: (content: string) => void,
  onImage?: (dataUrl: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let completed = false;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const checkAbort = () => {
    if (signal.aborted) throw new DOMException("Request stopped", "AbortError");
  };

  const processFrame = (frame: string) => {
    const payload = frame.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!payload || payload === "[DONE]") return;
    let event: { type?: string; content?: unknown; error?: unknown };
    try { event = JSON.parse(payload); }
    catch { throw new ChatStreamError(); }
    if (!event || typeof event !== "object") throw new ChatStreamError();
    if (event.error || event.type === "error") {
      // Provider messages can echo PHI, endpoints or credentials. Use a fixed message.
      throw new ChatStreamError("JMCGPT could not complete the request. Please retry.");
    }
    if (event.type === "image") {
      if (typeof event.content !== "string" || event.content.length > 6_000_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(event.content)) throw new ChatStreamError();
      onImage?.(event.content);
    } else if (event.type === "message" || event.type === "completed_message") {
      if (typeof event.content !== "string") throw new ChatStreamError();
      content = event.type === "completed_message" ? event.content : content + event.content;
      onContent(content);
      if (event.type === "completed_message") completed = true;
    } else if (event.type === "stream_end") {
      if (!content.trim()) throw new ChatStreamError("No response was received. Please retry.");
      completed = true;
    }
  };

  try {
    checkAbort();
    while (!completed) {
      const { done, value } = await reader.read();
      checkAbort();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 6_100_000) throw new ChatStreamError();
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        processFrame(frame);
        if (completed) break;
      }
      if (done) {
        if (!completed && buffer.trim()) processFrame(buffer);
        break;
      }
    }
    if (!completed) throw new ChatStreamError();
    if (!content.trim()) throw new ChatStreamError("No response was received. Please retry.");
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

import { useCallback, useEffect, useRef, useState } from "react";
import { IChatItem, SendOptions } from "../chatbot/types";
import { ChatStreamError, ChatTask, readChatStream } from "../chatbot/session";
import { prepareUploads, prepareWebPages, prepareWebSearch } from "../chatbot/uploads";

// A clinic may change this policy. This clears chat content, not the Entra login.
export const SESSION_IDLE_MINUTES = 15;
const IDLE_MS = SESSION_IDLE_MINUTES * 60 * 1000;

interface ActiveRequest { id: string; controller: AbortController }

export function useChatSession() {
  const [messageList, setMessageList] = useState<IChatItem[]>([]);
  const [task, setTask] = useState<ChatTask>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [sessionVersion, setSessionVersion] = useState(0);
  const [canRetry, setCanRetry] = useState(false);
  const active = useRef<ActiveRequest>();
  const lastRequest = useRef<IChatItem[]>();
  const messages = useRef<IChatItem[]>([]);
  const mounted = useRef(true);

  const setMessages = useCallback((next: IChatItem[]) => {
    messages.current = next;
    setMessageList(next);
  }, []);

  const clearSession = useCallback((reason?: string) => {
    const request = active.current;
    active.current = undefined;
    request?.controller.abort();
    lastRequest.current = undefined;
    setMessages([]);
    setTask(undefined);
    setError(undefined);
    setCanRetry(false);
    setNotice(reason);
    setSessionVersion((value) => value + 1);
  }, [setMessages]);

  const execute = useCallback(async (history: IChatItem[]) => {
    if (active.current) return;
    const id = crypto.randomUUID();
    const controller = new AbortController();
    active.current = { id, controller };
    const startedAt = performance.now();
    const assistant: IChatItem = {
      id, content: "", role: "assistant", isAnswer: true, status: "working",
      more: { time: new Date().toISOString() },
    };
    lastRequest.current = history;
    setMessages([...history, assistant]);
    setError(undefined);
    setNotice(undefined);
    setCanRetry(false);
    setTask({ id, phase: "working", startedAt });
    const isCurrent = () => mounted.current && active.current?.id === id;
    const updateAssistant = (patch: Partial<IChatItem>) => {
      if (!isCurrent()) return;
      setMessages(messages.current.map((item) => item.id === id ? { ...item, ...patch } : item));
    };
    let phase: ChatTask["phase"] = "completed";
    // A stalled connection must not leave the clock running indefinitely.
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 240_000);
    try {
      // Parse/transcribe only on Send. Prepared parts replace raw files in memory
      // so follow-up questions and retries do not re-upload or re-transcribe.
      for (let index = 0; index < history.length; index += 1) {
        const item = history[index];
        if (item.webQuery) {
          const parts = await prepareWebSearch(item.webQuery, controller.signal);
          if (!isCurrent()) return;
          history = history.map((message, position) => position === index
            ? {...message, attachments: [...(message.attachments ?? []), ...parts], webQuery: undefined} : message);
          lastRequest.current = history;
          setMessages([...history, messages.current.find(message => message.id === id) ?? assistant]);
        }
        if (item.webUrls?.length) {
          const parts = await prepareWebPages(item.webUrls, controller.signal);
          if (!isCurrent()) return;
          history = history.map((message, position) => position === index
            ? {...message, attachments: [...(message.attachments ?? []), ...parts], webUrls: undefined} : message);
          lastRequest.current = history;
          setMessages([...history, messages.current.find(message => message.id === id) ?? assistant]);
        }
        if (item.uploads?.length) {
          const attachments = await prepareUploads(item.uploads, controller.signal);
          if (!isCurrent()) return;
          history = history.map((message, position) => position === index
            ? {...message, attachments: [...(message.attachments ?? []), ...attachments], uploads: undefined} : message);
          lastRequest.current = history;
          setMessages([...history, messages.current.find(message => message.id === id) ?? assistant]);
        }
      }
      if (!isCurrent()) return;
      const response = await fetch("/chat", {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json", "Accept": "text/event-stream", "X-JMCGPT-Data-Classification": "non-sensitive" },
        signal: controller.signal,
        body: JSON.stringify({ mode: history.at(-1)?.requestMode ?? "chat", messages: history.map((item) => ({
          role: item.isAnswer ? "assistant" : "user", content: item.content,
          ...(item.attachments?.length ? {attachments: item.attachments} : {}),
        })) }),
      });
      if (!response.ok) {
        // A forbidden request is not proof of an expired authentication session.
        let originRejected = false;
        if (response.status === 403 && response.headers.get("content-type")?.includes("application/json")) {
          const failure = await response.json().catch(() => undefined);
          originRejected = failure?.error?.code === "origin_rejected";
        }
        const message = response.status === 401
          ? "Your sign-in has expired. Sign in again to continue."
          : response.status === 403 ? originRejected
            ? "JMCGPT rejected this connection. Reload the page and try again."
            : "Access to this request was denied. Contact your administrator if this continues."
          : response.status === 429 ? "JMCGPT is busy. Wait briefly, then retry."
          : response.status === 413 || response.status === 422 ? "The request could not be accepted. Shorten the message or start a new chat."
          : "JMCGPT could not complete the request. Please retry.";
        throw new ChatStreamError(message);
      }
      if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
        throw new ChatStreamError("The chat connection could not be opened. Please retry.");
      }
      await readChatStream(response.body, controller.signal, (content) => {
        if (!isCurrent()) return;
        updateAssistant({ content, status: "writing" });
        setTask({ id, phase: "writing", startedAt });
      }, (generatedImage) => updateAssistant({generatedImage}));
    } catch (cause) {
      if (!isCurrent()) return;
      if (controller.signal.aborted && !timedOut) {
        phase = "stopped";
      } else {
        phase = "failed";
        setError(timedOut ? "The request timed out. Please retry."
          : cause instanceof ChatStreamError ? cause.message
          : "The connection was interrupted. Please retry.");
      }
      setCanRetry(true);
    } finally {
      window.clearTimeout(timeout);
      if (isCurrent()) {
        const durationMs = performance.now() - startedAt;
        updateAssistant({ status: phase, duration: durationMs });
        setTask({ id, phase, startedAt, durationMs });
        active.current = undefined;
      }
    }
  }, [setMessages]);

  const onSend = useCallback((text: string, editingId?: string, options?: SendOptions) => {
    if (active.current || !text.trim()) return;
    const index = editingId ? messages.current.findIndex((item) => item.id === editingId && !item.isAnswer) : -1;
    const history = index >= 0 ? messages.current.slice(0, index) : messages.current;
    const userMessage: IChatItem = {
      id: crypto.randomUUID(), role: "user", content: text.trim(),
      uploads: options?.files, uploadNames: options?.files?.length ? options.files.map(file => file.name) : undefined, requestMode: options?.mode ?? "chat",
      webUrls: options?.webUrls,
      webQuery: options?.webQuery,
      more: { time: new Date().toISOString() },
    };
    void execute([...history.filter((item) => item.content.trim()), userMessage]);
  }, [execute]);

  const retry = useCallback(() => {
    if (lastRequest.current) void execute(lastRequest.current);
  }, [execute]);

  const regenerate = useCallback(() => {
    if (active.current) return;
    let lastUser = messages.current.length - 1;
    while (lastUser >= 0 && messages.current[lastUser].isAnswer) lastUser -= 1;
    if (lastUser >= 0) void execute(messages.current.slice(0, lastUser + 1));
  }, [execute]);

  useEffect(() => {
    mounted.current = true;
    let timeout: number;
    const touch = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => clearSession("Chat cleared after inactivity."), IDLE_MS);
    };
    const leave = () => clearSession();
    const restore = (event: PageTransitionEvent) => { if (event.persisted) clearSession(); };
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    events.forEach((event) => window.addEventListener(event, touch, { passive: true }));
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", restore);
    touch();
    return () => {
      mounted.current = false;
      active.current?.controller.abort();
      active.current = undefined;
      lastRequest.current = undefined;
      messages.current = [];
      window.clearTimeout(timeout);
      events.forEach((event) => window.removeEventListener(event, touch));
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", restore);
    };
  }, [clearSession]);

  return {
    messageList, task, error, notice, sessionVersion, canRetry,
    isResponding: task?.phase === "working" || task?.phase === "writing",
    onSend, clearSession, retry, regenerate,
    stop: () => active.current?.controller.abort(),
  };
}

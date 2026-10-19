import { useEffect, useRef, useState } from "react";
import { ChatInputProps } from "./types";
import styles from "./ChatInput.module.css";

export const ChatInput: React.FC<ChatInputProps> = ({ onSubmit, isGenerating, currentUserMessage, draft, onStop }) => {
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState<string>();
  const [reading, setReading] = useState(false);
  const latestText = useRef(text);
  latestText.current = text;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (currentUserMessage !== undefined) setText(currentUserMessage); }, [currentUserMessage]);
  useEffect(() => { if (draft !== undefined) { setText(draft.text); textarea.current?.focus(); } }, [draft]);
  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = "auto";
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 220)}px`;
  }, [text]);
  const send = () => {
    if (isGenerating || reading || !text.trim()) return;
    onSubmit(text.trim());
    setText("");
    setFileError(undefined);
  };
  const attach = async (file?: File) => {
    if (!file) return;
    if (!/\.(txt|md|csv|json)$/i.test(file.name) || file.size > 256 * 1024) {
      setFileError("Choose a TXT, Markdown, CSV or JSON file up to 256 KB.");
      return;
    }
    setReading(true);
    setFileError(undefined);
    try {
      const body = await file.text();
      if (!mounted.current) return;
      if (body.includes("\u0000")) throw new Error("binary");
      // Parsed on this device; the content is sent only when the user presses Send.
      const name = file.name.replace(/[\r\n\u0000-\u001f]/g, " ").slice(0, 160);
      const previous = latestText.current;
      const next = `${previous}${previous ? "\n\n" : ""}[Attached document: ${name}]\n${body}\n[End attached document]`;
      if (next.length > 400_000) {
        setFileError("The combined message is too large. Remove some text before attaching this file.");
        return;
      }
      setText(next);
      textarea.current?.focus();
    } catch {
      if (mounted.current) setFileError("This text file could not be read.");
    } finally {
      if (mounted.current) setReading(false);
    }
  };
  return (
    <div className={styles.composer}>
      <textarea ref={textarea} aria-label="Message JMCGPT" placeholder="Message JMCGPT…"
        value={text} rows={2} autoComplete="off" spellCheck={false} maxLength={400_000}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault(); send();
          }
        }} />
      <div className={styles.controls}>
        <input ref={fileInput} type="file" accept=".txt,.md,.csv,.json" hidden aria-label="Attach text or CSV file"
          onChange={(event) => { void attach(event.target.files?.[0]); event.target.value = ""; }} />
        <button type="button" className={styles.attach} disabled={reading || isGenerating}
          onClick={() => fileInput.current?.click()} title="Attach a text or CSV file; files stay in this session">
          {reading ? "Reading file…" : "Attach text file"}
        </button>
        {isGenerating
          ? <button type="button" className={styles.stop} onClick={onStop}>Stop</button>
          : <button type="button" className={styles.send} disabled={!text.trim() || reading} onClick={send}>Send</button>}
      </div>
      {fileError && <p role="alert" className={styles.fileError}>{fileError}</p>}
    </div>
  );
};
export default ChatInput;

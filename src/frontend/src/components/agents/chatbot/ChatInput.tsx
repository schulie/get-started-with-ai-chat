import { useEffect, useRef, useState } from "react";
import { ChatInputProps } from "./types";
import styles from "./ChatInput.module.css";
import { Dictation } from "./Dictation";

const ACCEPT = ".pdf,.docx,.xlsx,.csv,.tsv,.txt,.md,.json,.png,.jpg,.jpeg,.webp,.wav,.mp3,.m4a,.ogg,.webm,.flac";
const SUPPORTED = /\.(pdf|docx|xlsx|csv|tsv|txt|md|json|png|jpe?g|webp|wav|mp3|m4a|ogg|webm|flac)$/i;
type Tool = "chat" | "web" | "image" | "video";

export const ChatInput: React.FC<ChatInputProps> = ({ onSubmit, isGenerating, currentUserMessage, draft, onStop }) => {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string>();
  const [tool, setTool] = useState<Tool>("chat");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [connection, setConnection] = useState<"loading" | "ready" | "error">("loading");
  const [beta, setBeta] = useState(false);
  const [webEnabled, setWebEnabled] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dictating, setDictating] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/capabilities", {credentials: "include", cache: "no-store", signal: controller.signal})
      .then(response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(value => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(value?.capabilities) || !value.capabilities.includes("chat")) throw new Error();
        setCapabilities(value.capabilities); setBeta(value.dataMode === "non_sensitive_beta");
        setWebEnabled(value.webEnabled === true); setVideoEnabled(value.videoAnalysis === true); setConnection("ready");
      }).catch(() => { if (!controller.signal.aborted) setConnection("error"); });
    return () => controller.abort();
  }, []);
  useEffect(() => { if (currentUserMessage !== undefined) setText(currentUserMessage); }, [currentUserMessage]);
  useEffect(() => { if (draft !== undefined) { setText(draft.text); setTool("chat"); textarea.current?.focus(); } }, [draft]);
  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = "auto";
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 180)}px`;
  }, [text, tool]);

  const canSend = connection === "ready" && !isGenerating && !dictating && (!!text.trim() || files.length > 0);
  const chooseTool = (next: Tool) => {
    if(dictating)return;
    if (next !== tool && files.length) { setFileError("Remove the attached files before switching tools."); return; }
    setTool(next); setFileError(undefined); textarea.current?.focus();
  };
  const send = () => {
    if (!canSend) return;
    const value = text.trim();
    if (tool === "image" && (!value || value.length > 4000)) {
      setFileError("Describe the image or edit in up to 4,000 characters."); return;
    }
    if (tool === "web") {
      if (files.length || value.length < 3 || value.length > 1000) {
        setFileError("Use a public query or page URL of 3–1,000 characters, without attachments."); return;
      }
      if (/^https?:\/\//i.test(value)) {
        try { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || /\s/.test(value)) throw new Error(); }
        catch { setFileError("Paste a public HTTPS page URL without sign-in details."); return; }
        onSubmit(`Summarize this public page and cite its source: ${value}`, {mode: "chat", webUrls: [value]});
      } else {
        onSubmit(value, {mode: "chat", webQuery: value});
      }
      // Follow-up conversation stays out of search unless Web is selected again.
      setTool("chat");
    } else {
      if (tool === "video" && !files.length) { setFileError("Attach a short video to analyze."); return; }
      onSubmit(value || (tool === "video" ? "Summarize the video with sampled-frame timestamps and any audio transcript. State the sampling limitations."
        : "Review the attached sources and explain their contents."), {files, mode: tool === "image" ? "image" : "chat"});
    }
    setText(""); setFiles([]); setFileError(undefined); textarea.current?.focus();
  };
  const attach = (selected: File[]) => {
    if (isGenerating || dictating || !selected.length) return;
    if (tool === "web") { setFileError("Switch to Chat to attach files. Web sends only a public query or URL."); return; }
    const next = [...files, ...selected];
    if (next.length > 6 || next.some(file => !(SUPPORTED.test(file.name) || videoEnabled && /\.(mp4|mov|mkv)$/i.test(file.name)) || file.size > 8 * 1024 * 1024)
      || next.reduce((sum, file) => sum + file.size, 0) > 12 * 1024 * 1024) {
      setFileError("Choose up to 6 supported files: 8 MiB per file, 12 MiB combined."); return;
    }
    if (tool === "image" && (next.length > 1 || next.some(file => !/\.(png|jpe?g|webp)$/i.test(file.name)))) {
      setFileError("For an image edit, attach one PNG, JPEG or WebP image."); return;
    }
    if (tool === "video" && (next.length !== 1 || !/\.(mp4|mov|mkv|webm)$/i.test(next[0].name))) {
      setFileError("Choose one MP4, MOV, MKV or WebM video, up to 60 seconds and 8 MiB."); return;
    }
    setFiles(next); setFileError(undefined); textarea.current?.focus();
  };

  return <div className={styles.composer} data-dragging={dragging}
    onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); setDragging(false); attach(Array.from(event.dataTransfer.files)); }}>
    {beta && <div className={styles.betaNotice} role="note">
      <span><strong>Beta · No patient data</strong><span className={styles.retention}> · Azure may retain content</span></span>
    </div>}
    {connection !== "ready" && <p role="status" className={styles.connection}>
      {connection === "loading" ? "Connecting…" : "Connection unavailable. Reload the page to reconnect."}
    </p>}
    <textarea ref={textarea} aria-label="Message JMCGPT"
      placeholder={tool === "web" ? "Search the web or paste a public page URL…" : tool === "image" ? "Describe an image, or drop an image to edit…" : tool === "video" ? "Drop a short video and ask about it…" : "Ask anything, or drop a file…"}
      value={text} rows={2} autoComplete="off" spellCheck={false} maxLength={tool === "web" ? 1000 : tool === "image" ? 4000 : 300_000}
      onChange={event => setText(event.target.value)}
      onPaste={event => {
        const pasted = Array.from(event.clipboardData.items).filter(item => item.kind === "file").map(item => item.getAsFile()).filter((file): file is File => !!file);
        if (pasted.length) { event.preventDefault(); attach(pasted); }
      }}
      onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
    {files.length > 0 && <ul className={styles.files} aria-label="Pending attachments">{files.map((file, index) =>
      <li key={index}><span>{file.name}</span><button type="button" disabled={isGenerating} aria-label={`Remove ${file.name}`}
        onClick={() => setFiles(files.filter((_, position) => position !== index))}>×</button></li>)}</ul>}
    {tool === "web" && <p className={styles.toolHint}>Only this public query goes to Bing, under separate data terms. Chat history and files are excluded. A pasted URL goes only to that website.</p>}
    {tool === "image" && <p className={styles.toolHint}>Describe a new image, or attach one image and describe the changes.</p>}
    {tool === "video" && <p className={styles.toolHint}>Analyze a clip, read visible text, or transcribe its audio. Up to 60 seconds, 8 MiB, 1080p / 60 fps. Eight sampled frames may miss brief events. Video generation awaits a connected provider.</p>}
    <div className={styles.controls}>
      <input ref={fileInput} type="file" accept={tool === "image" ? ".png,.jpg,.jpeg,.webp" : tool === "video" ? ".mp4,.mov,.mkv,.webm" : ACCEPT + (videoEnabled ? ",.mp4,.mov,.mkv" : "")} multiple={tool !== "image" && tool !== "video"}
        hidden aria-label="Attach files" onChange={event => { attach(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <button type="button" className={styles.attach} aria-label="Attach files"
        disabled={isGenerating || dictating || connection !== "ready" || tool === "web"}
        onClick={() => fileInput.current?.click()}
        title="Attach documents, images, audio or short videos. Up to 6 files; 8 MiB each, 12 MiB total. Sent only when you press Send.">＋</button>
      <div className={styles.tools} role="group" aria-label="Choose a tool">
        <button type="button" aria-pressed={tool === "chat"} disabled={isGenerating || dictating} onClick={() => chooseTool("chat")}>Chat</button>
        {webEnabled && <button type="button" aria-pressed={tool === "web"} disabled={isGenerating || dictating} onClick={() => chooseTool("web")}>Web</button>}
        {capabilities.includes("images") && <button type="button" aria-pressed={tool === "image"} disabled={isGenerating || dictating} onClick={() => chooseTool("image")}>Image</button>}
        {videoEnabled && <button type="button" aria-pressed={tool === "video"} disabled={isGenerating || dictating} onClick={() => chooseTool("video")}>Video</button>}
      </div>
      {beta && capabilities.includes("transcription") && <Dictation disabled={isGenerating || connection!=="ready" || tool!=="chat"}
        onBusy={setDictating} onText={value=>setText(previous=>(previous?previous+"\n":"")+value)} />}
      {isGenerating ? <button type="button" className={styles.stop} aria-label="Stop response" onClick={onStop}>Stop</button>
        : <button type="button" className={styles.send} aria-label="Send message" disabled={!canSend} onClick={send}>↑</button>}
    </div>
    {dragging && <p className={styles.dropHint}>Drop files here</p>}
    {fileError && <p role="alert" className={styles.fileError}>{fileError}</p>}
  </div>;
};
export default ChatInput;

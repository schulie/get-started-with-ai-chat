import { AttachmentPart } from "./types";
import { ChatStreamError } from "./session";

async function encode(file: File, signal: AbortSignal): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}

export async function prepareUploads(files: File[], signal: AbortSignal): Promise<AttachmentPart[]> {
  if (files.length > 6 || files.some(file => file.size > 8 * 1024 * 1024)
    || files.reduce((total, file) => total + file.size, 0) > 12 * 1024 * 1024) {
    throw new ChatStreamError("The attachments exceed the upload limits.");
  }
  const encoded = [];
  for (const file of files) encoded.push({name: file.name, data: await encode(file, signal)});
  const response = await fetch("/api/attachments", {method: "POST", credentials: "include", cache: "no-store",
    headers: {"Content-Type": "application/json", "X-JMCGPT-Data-Classification": "non-sensitive"}, signal, body: JSON.stringify({files: encoded})});
  if (!response.ok) {
    const code = await response.json().then(value => value?.error?.code).catch(() => undefined);
    const message = response.status === 401 ? "Your sign-in has expired. Sign in again to continue."
      : response.status === 403 ? "You do not have access to process files. Contact your administrator."
      : code === "capability_unavailable" ? "This type of upload has not been enabled by your administrator."
      : code === "too_many_scanned_pages" ? "This PDF has too many scanned pages. Upload a smaller section."
      : code === "encrypted_or_large_pdf" ? "Use an unlocked PDF with no more than 40 pages."
      : code === "unsafe_office_file" ? "This Office file contains unsupported or unsafe archive content. Export it as a PDF or plain text."
      : code === "video_limits" ? "Use a video up to 60 seconds, 1080p / 60 fps, with one video track and at most one stereo audio track."
      : code === "invalid_video" ? "This video could not be decoded. Export a self-contained MP4, MOV, MKV or WebM clip and retry."
      : ["uploads_too_large", "document_too_large", "spreadsheet_too_large", "empty_or_large_document"].includes(code)
        ? "This document is empty or exceeds the processing limits. Upload a smaller section."
      : response.status === 429 ? "JMCGPT is busy. Wait briefly, then retry."
      : "The files could not be processed. Check the format and size, then retry.";
    throw new ChatStreamError(message);
  }
  const value = await response.json();
  if (!Array.isArray(value.parts) || value.parts.length > 14) throw new ChatStreamError();
  for (const part of value.parts) {
    if (part.type === "text" && typeof part.text === "string" && part.text.length <= 300_000) continue;
    if (part.type === "image" && typeof part.data_url === "string" && part.data_url.length <= 6_000_000
      && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(part.data_url)) continue;
    throw new ChatStreamError();
  }
  return value.parts;
}

export async function prepareWebPages(urls: string[], signal: AbortSignal): Promise<AttachmentPart[]> {
  const response = await fetch("/api/web", {method: "POST", credentials: "include", cache: "no-store", signal,
    headers: {"Content-Type": "application/json", "X-JMCGPT-Data-Classification": "non-sensitive"},
    body: JSON.stringify({urls})});
  if (!response.ok) throw new ChatStreamError("The public page could not be read. Use a public HTTPS page without sign-in; private networks and downloads are blocked.");
  const result = await response.json();
  if (!Array.isArray(result.parts) || result.parts.length > 2 || result.parts.some((part: AttachmentPart) =>
    part.type !== "text" || typeof part.text !== "string" || part.text.length > 83_000)) throw new ChatStreamError();
  return result.parts;
}

export async function prepareWebSearch(query: string, signal: AbortSignal): Promise<AttachmentPart[]> {
  const response = await fetch("/api/search", {method: "POST", credentials: "include", cache: "no-store", signal,
    headers: {"Content-Type": "application/json", "X-JMCGPT-Data-Classification": "non-sensitive"},
    body: JSON.stringify({query})});
  if (!response.ok) throw new ChatStreamError("Web search is unavailable. Retry with a public query or provide a public page URL.");
  const result = await response.json();
  if (!Array.isArray(result.parts) || result.parts.length !== 1 || result.parts.some((part: AttachmentPart) =>
    part.type !== "text" || typeof part.text !== "string" || part.text.length > 83_000)) throw new ChatStreamError();
  return result.parts;
}

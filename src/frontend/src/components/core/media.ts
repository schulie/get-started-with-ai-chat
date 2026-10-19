export type MediaKind = "video" | "audio" | "pdf" | "link";

/** Model-written URLs are untrusted. External media is linked, never auto-loaded. */
export function mediaTarget(raw: string, origin: string) {
  try {
    const url = new URL(raw, origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const sameOrigin = url.origin === new URL(origin).origin;
    if (url.protocol === 'http:' && !sameOrigin) return null;
    const path = url.pathname.toLowerCase();
    const kind: MediaKind = /\.(mp4|webm|ogv)$/.test(path) ? 'video'
      : /\.(mp3|wav|ogg|m4a|aac)$/.test(path) ? 'audio'
      : /\.pdf$/.test(path) ? 'pdf' : 'link';
    // Do not turn arbitrary authenticated GET endpoints into automatic image requests.
    const canEmbed = sameOrigin && /^\/(static|media)\//.test(url.pathname);
    return { href: url.href, kind, canEmbed };
  } catch { return null; }
}

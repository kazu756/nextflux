import { getAllowedBunshunImageUrl } from "./bunshunImageUrl.js";

function decodeGoBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value) || value.length % 4 !== 0)
    return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    if (btoa(binary).replace(/\+/g, "-").replace(/\//g, "_") !== value)
      return null;
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

// Miniflux internal/mediaproxy/url.go: padded base64.URLEncoding of
// HMAC-SHA256 and UTF-8 media URL. This decodes structure, not HMAC authenticity.
function unwrapMinifluxProxy(source, serverUrl) {
  if (typeof source !== "string" || source.length > 4096 || !serverUrl)
    return null;
  try {
    const server = new URL(serverUrl);
    if (
      !["https:", "http:"].includes(server.protocol) ||
      server.username ||
      server.password ||
      server.search ||
      server.hash
    )
      return null;
    // Accept an absolute URL or a root-relative URL, never guess relative paths.
    if (!source.startsWith("/") && !/^https?:\/\//i.test(source)) return null;
    if (/[\s\\]/.test(source)) return null;
    const proxy = new URL(source, server.origin);
    const prefix = server.pathname.replace(/\/$/, "") + "/proxy/";
    if (
      proxy.origin !== server.origin ||
      proxy.username ||
      proxy.password ||
      proxy.search ||
      proxy.hash ||
      !proxy.pathname.startsWith(prefix)
    )
      return null;
    const parts = proxy.pathname.slice(prefix.length).split("/");
    if (parts.length !== 2) return null;
    const digest = decodeGoBase64Url(parts[0]);
    const bytes = decodeGoBase64Url(parts[1]);
    if (digest?.length !== 32 || !bytes) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function getWorkerEndpoint(base) {
  if (typeof base !== "string" || !base || base.length > 2048) return null;
  try {
    const url = new URL(base);
    const local = url.protocol === "http:" && url.hostname === "127.0.0.1";
    if (
      (!local && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return null;
    return new URL("/image", url);
  } catch {
    return null;
  }
}

export function getArticleImageSource(source, workerBase, minifluxServerUrl) {
  const endpoint = getWorkerEndpoint(workerBase);
  if (!endpoint) return source;
  const target =
    getAllowedBunshunImageUrl(source) ||
    getAllowedBunshunImageUrl(unwrapMinifluxProxy(source, minifluxServerUrl));
  if (!target) return source;
  endpoint.searchParams.set("url", target);
  return endpoint.href;
}

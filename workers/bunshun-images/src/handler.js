import { getAllowedBunshunImageUrl } from "../../../src/domain/articles/bunshunImageUrl.js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10000;
const CACHE_SECONDS = 3600;

function failure(status, message) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isRaster(bytes, type) {
  const starts = (...values) =>
    values.every((value, index) => bytes[index] === value);
  if (type === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (type === "image/png") return starts(137, 80, 78, 71, 13, 10, 26, 10);
  const ascii = (offset, count) =>
    String.fromCharCode(...bytes.slice(offset, offset + count));
  if (type === "image/gif") return ["GIF87a", "GIF89a"].includes(ascii(0, 6));
  if (type === "image/webp")
    return ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
  return false;
}

async function readBounded(body, signal) {
  if (!body) return null;
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  const cancel = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) return null;
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        cancel();
        return null;
      }
      chunks.push(value);
    }
    if (signal.aborted) return null;
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

// Dependencies are injected only for deterministic offline tests.
export async function handleImageRequest(
  request,
  {
    fetchImage = fetch,
    cache,
    waitUntil = () => {},
    timeoutMs = TIMEOUT_MS,
  } = {},
) {
  if (!["GET", "HEAD"].includes(request.method)) {
    const response = failure(405, "Method not allowed");
    response.headers.set("Allow", "GET, HEAD");
    return response;
  }
  const incoming = new URL(request.url);
  if (incoming.pathname !== "/image") return failure(404, "Not found");
  const keys = [...incoming.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "url")
    return failure(400, "Expected one image URL");
  const target = getAllowedBunshunImageUrl(incoming.searchParams.get("url"));
  if (!target) return failure(400, "Image URL not allowed");

  // Canonical key excludes caller headers and irrelevant encodings.
  const cacheUrl = new URL("/image", incoming.origin);
  cacheUrl.searchParams.set("url", target);
  const cacheKey = new Request(cacheUrl.href);
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return request.method === "HEAD" ? new Response(null, hit) : hit;
    } catch {
      /* Cache availability must not decide image availability. */
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let upstream;
  try {
    // Never clone incoming request headers (cookies, tokens, Origin or Referer).
    // Fetch GET for HEAD too, so MIME and actual file signature are validated.
    upstream = await fetchImage(target, {
      method: "GET",
      redirect: "manual",
      headers: {
        Referer: "https://bunshun.jp/",
        Accept: "image/jpeg,image/png,image/gif,image/webp",
      },
      signal: controller.signal,
    });
    if ([403, 404, 429].includes(upstream.status))
      return failure(upstream.status, "Upstream image unavailable");
    if (upstream.status !== 200)
      return failure(502, "Unexpected upstream status");
    const type = (upstream.headers.get("Content-Type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(type))
      return failure(502, "Unsupported image type");
    const length = upstream.headers.get("Content-Length");
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_IMAGE_BYTES))
      return failure(413, "Image too large");
    const bytes = await readBounded(upstream.body, controller.signal);
    if (controller.signal.aborted)
      return failure(504, "Image request timed out");
    if (!bytes) return failure(413, "Image too large");
    if (!isRaster(bytes, type)) return failure(502, "Invalid image signature");
    const response = new Response(bytes, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=" + CACHE_SECONDS,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
    if (cache) waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
    return request.method === "HEAD" ? new Response(null, response) : response;
  } catch {
    return failure(controller.signal.aborted ? 504 : 502, "Image fetch failed");
  } finally {
    clearTimeout(timer);
    if (upstream?.body && !upstream.bodyUsed) {
      upstream.body.cancel().catch(() => {});
    }
  }
}

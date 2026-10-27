import {
  parseBunshunArticleUrl,
  bunshunPageUrl,
} from "../../../src/domain/articles/bunshunArticleUrl.js";
import { extractBunshunPage } from "./extract.js";

export const PAGE_BYTES = 512 * 1024;
export const TOTAL_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();
let activeCollections = 0;

async function limitedBody(response, signal, budget) {
  const length = response.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > budget))
    throw new Error("HTML size limit exceeded");
  if (!response.body) throw new Error("Empty response");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  const cancel = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error("Article request timed out");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > budget) {
        cancel();
        throw new Error("HTML size limit exceeded");
      }
      chunks.push(value);
    }
    if (signal.aborted) throw new Error("Article request timed out");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return {
      html: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      size,
    };
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export async function collectBunshunArticle(
  input,
  { fetchPage = fetch, timeoutMs = 15000 } = {},
) {
  const article = parseBunshunArticleUrl(input);
  if (!article) throw new Error("Unsupported article URL");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const contents = [];
  const sources = [];
  const seen = new Set();
  let total = 0;
  let manifest = [1];
  let identity;
  let page = 1;
  try {
    for (page = 1; page <= manifest.length; page++) {
      let url = bunshunPageUrl(article.base, page);
      let response;
      for (let redirect = 0; ; redirect++) {
        if (controller.signal.aborted)
          throw new Error("Article request timed out");
        if (seen.has(url))
          throw new Error("Repeated request or redirect cycle");
        seen.add(url);
        response = await fetchPage(url, {
          method: "GET",
          redirect: "manual",
          headers: { Accept: "text/html" },
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("Location");
          response.body?.cancel().catch(() => {});
          if (!location || redirect >= 2)
            throw new Error("Redirect limit exceeded");
          const next = new URL(location, url).href;
          const parsed = parseBunshunArticleUrl(next);
          if (parsed?.base !== article.base || parsed.page !== page)
            throw new Error("Redirect outside requested article page");
          url = next;
          continue;
        }
        break;
      }
      if (response.status !== 200) {
        response.body?.cancel().catch(() => {});
        throw new Error("Upstream HTTP " + response.status);
      }
      const type = response.headers.get("Content-Type") || "";
      if (
        !/^text\/html(?:;|$)/i.test(type) ||
        (/charset=/i.test(type) && !/charset=["']?utf-8/i.test(type))
      ) {
        response.body?.cancel().catch(() => {});
        throw new Error("Unsupported HTML content type");
      }
      const body = await limitedBody(
        response,
        controller.signal,
        Math.min(PAGE_BYTES, TOTAL_BYTES - total),
      );
      total += body.size;
      const extracted = extractBunshunPage(
        body.html,
        bunshunPageUrl(article.base, page),
      );
      if (page === 1) {
        manifest = extracted.pages;
        identity = extracted.identity;
      }
      if (extracted.identity !== identity)
        throw new Error("記事のcanonicalがページ間で一致しません。");
      if (extracted.pages.join(",") !== manifest.join(","))
        throw new Error("Page count changed during fetch");
      if (contents.some((content) => content.plain === extracted.plain))
        throw new Error("Repeated page body");
      contents.push(extracted);
      sources.push(bunshunPageUrl(article.base, page));
    }
    const content = contents
      .map(
        (part, index) =>
          '<section data-bunshun-page="' +
          (index + 1) +
          '"><h2>' +
          (index + 1) +
          " / " +
          contents.length +
          "</h2>" +
          part.content +
          "</section>",
      )
      .join("");
    if (encoder.encode(content).length > 1024 * 1024)
      throw new Error("Combined body exceeds limit");
    return {
      url: article.base,
      pageCount: contents.length,
      complete: true,
      content,
      sources,
    };
  } catch (error) {
    throw new Error(
      "Page " +
        page +
        ": " +
        (controller.signal.aborted
          ? "Article request timed out"
          : error.message),
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function handleArticleRequest(
  request,
  env = {},
  { cache, waitUntil = () => {}, fetchPage = fetch } = {},
) {
  const origin = request.headers.get("Origin");
  const origins = (env.ALLOWED_ORIGINS || "http://127.0.0.1:5174")
    .split(",")
    .map((value) => value.trim());
  function reply(value, status = 200) {
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    };
    if (origin && origins.includes(origin))
      headers["Access-Control-Allow-Origin"] = origin;
    return new Response(JSON.stringify(value), { status, headers });
  }
  if (origin && !origins.includes(origin))
    return reply({ error_message: "Origin not allowed" }, 403);
  const input = new URL(request.url);
  if (input.pathname !== "/article")
    return reply({ error_message: "Not found" }, 404);
  if (request.method === "OPTIONS") {
    if (
      request.headers.get("Access-Control-Request-Method") !== "GET" ||
      request.headers.get("Access-Control-Request-Headers")
    )
      return reply({ error_message: "Preflight not allowed" }, 403);
    const response = reply({});
    response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    return response;
  }
  if (request.method !== "GET")
    return reply({ error_message: "Method not allowed" }, 405);
  const keys = [...input.searchParams.keys()];
  const article = parseBunshunArticleUrl(input.searchParams.get("url"));
  if (keys.length !== 1 || keys[0] !== "url" || !article)
    return reply({ error_message: "Unsupported article URL" }, 400);
  const key = new Request(
    input.origin + "/article?url=" + encodeURIComponent(article.base),
  );
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) {
        const response = reply(await hit.json());
        response.headers.set("Cache-Control", "public, max-age=300");
        return response;
      }
    } catch {
      /* Cache is optional. */
    }
  }
  if (activeCollections >= 2)
    return reply({ error_message: "Article collector busy" }, 429);
  activeCollections++;
  try {
    const result = await collectBunshunArticle(article.base, { fetchPage });
    const response = reply(result);
    response.headers.set("Cache-Control", "public, max-age=300");
    if (cache) {
      const stored = new Response(JSON.stringify(result), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
        },
      });
      waitUntil(cache.put(key, stored).catch(() => {}));
    }
    return response;
  } catch (error) {
    return reply({ error_message: error.message }, 502);
  } finally {
    activeCollections--;
  }
}

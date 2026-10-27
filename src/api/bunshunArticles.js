import {
  parseBunshunArticleUrl,
  MAX_BUNSHUN_PAGES,
} from "../domain/articles/bunshunArticleUrl.js";

export class BunshunArticleError extends Error {
  name = "BunshunArticleError";
}

export async function fetchBunshunArticle(
  url,
  workerBase,
  fetchRequest = fetch,
) {
  try {
    const article = parseBunshunArticleUrl(url);
    const endpoint = new URL(workerBase);
    if (
      !article ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/" ||
      !(
        endpoint.protocol === "https:" ||
        (endpoint.protocol === "http:" && endpoint.hostname === "127.0.0.1")
      )
    )
      throw new Error("Invalid Bunshun article worker URL");
    endpoint.pathname = "/article";
    endpoint.searchParams.set("url", article.base);
    const response = await fetchRequest(endpoint.href, {
      method: "GET",
      credentials: "omit",
      mode: "cors",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error_message || "Article fetch failed");
    if (
      result.complete !== true ||
      result.url !== article.base ||
      !Number.isInteger(result.pageCount) ||
      result.pageCount < 1 ||
      result.pageCount > MAX_BUNSHUN_PAGES ||
      typeof result.content !== "string" ||
      !result.content ||
      result.content.length > 1024 * 1024
    )
      throw new Error("Incomplete article response");
    return result.content;
  } catch (error) {
    throw new BunshunArticleError(
      error.name === "TimeoutError"
        ? "Article request timed out"
        : error.message,
    );
  }
}

export function fetchReaderContent(
  article,
  workerBase,
  fetchMiniflux,
  fetchRequest = fetch,
) {
  return workerBase && parseBunshunArticleUrl(article.url)
    ? fetchBunshunArticle(article.url, workerBase, fetchRequest)
    : fetchMiniflux(article.id);
}

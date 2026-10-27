import test from "node:test";
import assert from "node:assert/strict";
import {
  collectBunshunArticle,
  TOTAL_BYTES,
} from "../../workers/bunshun-articles/src/handler.js";
const base = "https://bunshun.jp/articles/-/93048";
function html(page, count, padding) {
  return (
    '<link rel="canonical" href="' +
    base +
    '"><div class="article-body"><p>Public body page ' +
    page +
    " " +
    padding +
    '</p></div><div class="pagination article">' +
    Array.from({ length: count }, (_, i) => i + 1)
      .map((n) =>
        n === page
          ? '<a class="active" href="#">' + n + "</a>"
          : '<a href="' + base + "?page=" + n + '">' + n + "</a>",
      )
      .join("") +
    "</div>"
  );
}
test("article collector rejects total source and combined output size overflow", async () => {
  let bytes = 0;
  await assert.rejects(
    collectBunshunArticle(base, {
      fetchPage: async (url) => {
        const p = Number(new URL(url).searchParams.get("page") || 1);
        const value = html(p, 5, "x".repeat(450 * 1024));
        bytes += value.length;
        return new Response(value, {
          headers: { "Content-Type": "text/html" },
        });
      },
    }),
    /size limit/,
  );
  assert(bytes > TOTAL_BYTES);
  await assert.rejects(
    collectBunshunArticle(base, {
      fetchPage: async (url) =>
        new Response(
          html(
            Number(new URL(url).searchParams.get("page") || 1),
            3,
            "x".repeat(400 * 1024),
          ),
          { headers: { "Content-Type": "text/html" } },
        ),
    }),
    /Combined body/,
  );
});
test("article timeout also cancels a stalled response body", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<html>"));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    collectBunshunArticle(base, {
      timeoutMs: 5,
      fetchPage: async () =>
        new Response(body, { headers: { "Content-Type": "text/html" } }),
    }),
    /timed out/,
  );
  assert.equal(cancelled, true);
});

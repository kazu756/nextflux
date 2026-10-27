import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchReaderContent,
  fetchBunshunArticle,
  BunshunArticleError,
} from "../../src/api/bunshunArticles.js";
const base = "https://bunshun.jp/articles/-/93048";
const worker = "https://article.example.workers.dev";
test("unset Worker and other sites use Miniflux only", async () => {
  for (const [url, configured] of [
    [base, ""],
    ["https://other.example/article", worker],
  ]) {
    let calls = 0;
    const value = await fetchReaderContent(
      { id: 42, url },
      configured,
      async (id) => {
        assert.equal(id, 42);
        calls++;
        return "Miniflux body";
      },
      async () => {
        throw new Error("must not call Worker");
      },
    );
    assert.equal(value, "Miniflux body");
    assert.equal(calls, 1);
  }
});
test("Bunshun Worker call omits credentials and requires complete same-article response", async () => {
  const value = await fetchReaderContent(
    { id: 42, url: base + "?page=2" },
    worker,
    async () => {
      throw new Error("must not call Miniflux");
    },
    async (url, options) => {
      assert.equal(new URL(url).searchParams.get("url"), base);
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers, undefined);
      assert.equal(options.mode, "cors");
      return Response.json({
        url: base,
        pageCount: 3,
        complete: true,
        content: "safe joined body",
      });
    },
  );
  assert.equal(value, "safe joined body");
  for (const value of [
    { url: base, pageCount: 2, complete: false, content: "partial" },
    { url: base + "9", pageCount: 3, complete: true, content: "wrong article" },
    { url: base, pageCount: 6, complete: true, content: "over limit" },
  ]) {
    await assert.rejects(
      fetchBunshunArticle(base, worker, async () => Response.json(value)),
      BunshunArticleError,
    );
  }
  await assert.rejects(
    fetchBunshunArticle(base, worker, async () =>
      Response.json({ error_message: "Page 2 failed" }, { status: 502 }),
    ),
    /Page 2 failed/,
  );
});

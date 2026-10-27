import test from "node:test";
import assert from "node:assert/strict";
import { parseDocument } from "htmlparser2";
import { textContent } from "domutils";
import { parseBunshunArticleUrl } from "../../src/domain/articles/bunshunArticleUrl.js";
import { extractBunshunPage } from "../../workers/bunshun-articles/src/extract.js";
import {
  collectBunshunArticle,
  handleArticleRequest,
  PAGE_BYTES,
} from "../../workers/bunshun-articles/src/handler.js";

const base = "https://bunshun.jp/articles/-/93048";
function fixture(page = 1, count = 3, body = "", id = "93048") {
  const nav =
    count > 1
      ? '<div class="pagination article"><div class="page-num">' +
        Array.from({ length: count }, (_, i) => i + 1)
          .map((n) =>
            n === page
              ? '<a class="active menu-link" href="#">' + n + "</a>"
              : '<a class="menu-link" href="/articles/-/' +
                id +
                "?page=" +
                n +
                '">' +
                n +
                "</a>",
          )
          .join("") +
        (page < count
          ? '<a class="next" href="/articles/-/' +
            id +
            "?page=" +
            (page + 1) +
            '">Next</a>'
          : "") +
        "</div></div>"
      : "";
  return (
    '<html><head><link rel="canonical" href="https://bunshun.jp/articles/-/' +
    id +
    '"></head><body><div class="article-body"><p>Page ' +
    page +
    " begins with enough meaningful public article text for verification.</p><p>Repeated legitimate dialogue.</p>" +
    body +
    "<p>Page " +
    page +
    ' ends with its complete final paragraph.</p><a id="article-series-next-link" href="/articles/-/93049">Next article</a></div>' +
    nav +
    "</body></html>"
  );
}
const response = (html) =>
  new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
const origin = "http://127.0.0.1:5174";
const request = () =>
  new Request(
    "https://worker.example/article?url=" + encodeURIComponent(base),
    {
      headers: {
        Origin: origin,
        Authorization: "Bearer dummy-not-forwarded",
        Cookie: "dummy=not-forwarded",
      },
    },
  );

test("article URLs reject foreign IDs paths schemes credentials ports encodings and unsupported pages", () => {
  for (const value of [
    "https://bunshun.jp.evil.example/articles/-/93048",
    "http://bunshun.jp/articles/-/93048",
    "https://u:p@bunshun.jp/articles/-/93048",
    "https://bunshun.jp:443/articles/-/93048",
    base + "?page=6",
    base + "?page=2&extra=1",
    base + "?page=0",
    base + "#x",
    base + "\n",
    base.replace("93048", "%39%33%30%34%38"),
    "invalid",
  ]) {
    assert.equal(parseBunshunArticleUrl(value), null, value);
  }
  assert.equal(parseBunshunArticleUrl(base + "?page=2").base, base);
});

test("extractor validates canonical active page and pagination instead of next-article links", () => {
  const output = extractBunshunPage(fixture(3), base + "?page=3");
  assert.deepEqual(output.pages, [1, 2, 3]);
  assert.equal(output.content.includes("93049"), false);
  for (const html of [
    fixture(1, 6),
    fixture(1).replace(
      'href="/articles/-/93048?page=2"',
      'href="/articles/-/93049?page=2"',
    ),
    fixture(2),
    fixture(1).replace(
      'href="https://bunshun.jp/articles/-/93048"',
      'href="https://bunshun.jp/articles/-/93049"',
    ),
    fixture(1).replace('class="article-body"', 'class="other"'),
  ])
    assert.throws(() => extractBunshunPage(html, base));
  assert.deepEqual(extractBunshunPage(fixture(1, 1), base).pages, [1]);
});

test("sanitizer rebuilds safe markup and resolves images and links without scripts or event attributes", () => {
  const malicious =
    '<script>alert(1)</script><style>p{display:none}</style><iframe src="https://evil.example"></iframe><svg onload="alert(1)"></svg><form><input></form><p onclick="alert(1)">Keep this text.</p><a href="javascript:alert(1)">Safe text</a><img src="/mwimgs/a/photo.jpg" onerror="alert(1)"><img src="/icon.svg"><a href="/articles/photo/93048">Photos</a><div class="ad-banner"><p>Advertisement text</p></div>';
  const content = extractBunshunPage(fixture(1, 1, malicious), base).content;
  assert.equal(
    /<script|<style|<iframe|<svg|<form|onclick|onerror|javascript:|Advertisement text|icon.svg/.test(
      content,
    ),
    false,
  );
  assert(content.includes('src="https://bunshun.jp/mwimgs/a/photo.jpg"'));
  assert(content.includes('href="https://bunshun.jp/articles/photo/93048"'));
  assert(content.includes("Keep this text."));
  assert(content.includes("Safe text"));
});

test("collector fetches ordered same-ID pages serially preserving ends images links and repeated real paragraphs", async () => {
  const calls = [];
  let active = 0;
  let max = 0;
  const result = await collectBunshunArticle(base + "?page=3", {
    fetchPage: async (url, options) => {
      active++;
      max = Math.max(max, active);
      calls.push(url);
      assert.equal(options.redirect, "manual");
      assert.deepEqual(Object.keys(options.headers), ["Accept"]);
      const p = Number(new URL(url).searchParams.get("page") || 1);
      await Promise.resolve();
      active--;
      return response(
        fixture(
          p,
          3,
          '<img src="https://bunshun.ismcdn.jp/mwimgs/a/photo.jpg"><a href="/related">Keep link</a>',
        ),
      );
    },
  });
  assert.equal(result.complete, true);
  assert.equal(result.pageCount, 3);
  assert.equal(max, 1);
  assert.deepEqual(calls, [base, base + "?page=2", base + "?page=3"]);
  assert.equal(
    (result.content.match(/Repeated legitimate dialogue/g) || []).length,
    3,
  );
  assert(
    result.content.indexOf("Page 1 ends") <
      result.content.indexOf("Page 2 begins"),
  );
  assert(
    result.content.includes("Page 3 ends with its complete final paragraph."),
  );
  assert.equal(result.content.includes("93049"), false);
  assert(
    result.content.includes("https://bunshun.ismcdn.jp/mwimgs/a/photo.jpg"),
  );
});

test("collector refuses redirect escape loops repeated bodies and changing page counts", async () => {
  for (const location of [
    "https://other.example/",
    "/articles/-/93049",
    base,
  ]) {
    let calls = 0;
    await assert.rejects(
      collectBunshunArticle(base, {
        fetchPage: async () => {
          calls++;
          return new Response(null, {
            status: 302,
            headers: { Location: location },
          });
        },
      }),
    );
    assert(calls <= 2);
  }
  await assert.rejects(
    collectBunshunArticle(base, {
      fetchPage: async (url) =>
        response(
          fixture(
            new URL(url).searchParams.has("page") ? 2 : 1,
            new URL(url).searchParams.has("page") ? 2 : 3,
          ),
        ),
    }),
    /Page count changed/,
  );
  await assert.rejects(
    collectBunshunArticle(base, {
      fetchPage: async (url) => {
        const page = Number(new URL(url).searchParams.get("page") || 1);
        return response(fixture(page).replaceAll("Page " + page, "Page same"));
      },
    }),
    /Repeated page body/,
  );
});

test("size content type and timeout limits fail without returning partial content", async () => {
  await assert.rejects(
    collectBunshunArticle(base, {
      fetchPage: async () =>
        new Response("x", {
          headers: {
            "Content-Type": "text/html",
            "Content-Length": String(PAGE_BYTES + 1),
          },
        }),
    }),
    /size limit/,
  );
  await assert.rejects(
    collectBunshunArticle(base, {
      fetchPage: async () =>
        new Response("x".repeat(PAGE_BYTES + 1), {
          headers: { "Content-Type": "text/html" },
        }),
    }),
    /size limit/,
  );
  await assert.rejects(
    collectBunshunArticle(base, {
      fetchPage: async () =>
        new Response("<html></html>", {
          headers: { "Content-Type": "application/json" },
        }),
    }),
    /content type/,
  );
  await assert.rejects(
    collectBunshunArticle(base, {
      timeoutMs: 5,
      fetchPage: (_, options) =>
        new Promise((resolve, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    }),
    /timed out/,
  );
  const result = await handleArticleRequest(
    request(),
    {},
    {
      fetchPage: async (url) =>
        new URL(url).searchParams.has("page")
          ? new Response("Forbidden", { status: 403 })
          : response(fixture()),
    },
  );
  assert.equal(result.status, 502);
  const json = await result.json();
  assert.equal(json.content, undefined);
  assert.match(json.error_message, /Page 2.*403/);
});

test("CORS and method checks happen before any upstream request and auth headers are never forwarded", async () => {
  let calls = 0;
  const fetchPage = async () => {
    calls++;
    return response(fixture(1, 1));
  };
  const blocked = new Request(request(), {
    headers: { Origin: "https://other.example" },
  });
  assert.equal(
    (await handleArticleRequest(blocked, {}, { fetchPage })).status,
    403,
  );
  assert.equal(calls, 0);
  assert.equal(
    (
      await handleArticleRequest(
        new Request(request(), { method: "POST" }),
        {},
        { fetchPage },
      )
    ).status,
    405,
  );
  const result = await handleArticleRequest(
    request(),
    {},
    {
      fetchPage: async (url, options) => {
        assert.deepEqual(options.headers, { Accept: "text/html" });
        return fetchPage(url);
      },
    },
  );
  assert.equal(result.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(result.headers.get("Access-Control-Allow-Credentials"), null);
  assert.equal(result.status, 200);
});

test("collector bounds concurrent uncached requests per isolate", async () => {
  const releases = [];
  const fetchPage = () =>
    new Promise((resolve) =>
      releases.push(() => resolve(response(fixture(1, 1)))),
    );
  const first = handleArticleRequest(request(), {}, { fetchPage });
  const second = handleArticleRequest(request(), {}, { fetchPage });
  assert.equal(
    (await handleArticleRequest(request(), {}, { fetchPage })).status,
    429,
  );
  releases.forEach((release) => release());
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
});

test("sanitized result has text in all sections", async () => {
  const result = await collectBunshunArticle(base, {
    fetchPage: async (url) =>
      response(fixture(Number(new URL(url).searchParams.get("page") || 1))),
  });
  assert(textContent(parseDocument(result.content)).includes("Page 3 ends"));
});

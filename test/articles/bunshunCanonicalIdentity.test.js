import test from "node:test";
import assert from "node:assert/strict";
import { extractBunshunPage } from "../../workers/bunshun-articles/src/extract.js";
import {
  collectBunshunArticle,
  handleArticleRequest,
} from "../../workers/bunshun-articles/src/handler.js";

// Structural regression fixture from public article 93131, not copied article text.
const base = "https://bunshun.jp/articles/-/93131";
const canonical = "https://bunshun.jp/denshiban/articles/b15071";
function page(number = 1, original = canonical) {
  const schema = {
    "@type": "Article",
    headline: "Public republication title",
    mainEntityOfPage: { "@type": "WebPage", "@id": base },
  };
  return (
    '<html><head><link rel="canonical" href="' +
    original +
    '"><meta property="og:url" content="' +
    base +
    '"><script type="application/ld+json">' +
    JSON.stringify(schema) +
    '</script></head><body><h1>Public republication title</h1><div class="article-body"><p>Public page ' +
    number +
    ' with enough meaningful text to identify a complete body.</p></div><div class="pagination article">' +
    [1, 2]
      .map((n) =>
        n === number
          ? '<a class="active" href="#">' + n + "</a>"
          : '<a href="/articles/-/93131?page=' + n + '">' + n + "</a>",
      )
      .join("") +
    "</div></body></html>"
  );
}
test("93131 public republication permits its electronic canonical only with matching OG, schema and title", async () => {
  assert.equal(extractBunshunPage(page(), base).identity, canonical);
  assert.equal(
    extractBunshunPage(page(2), base + "?page=2").identity,
    canonical,
  );
  const urls = [];
  const result = await collectBunshunArticle(base, {
    fetchPage: async (url) => {
      urls.push(url);
      return new Response(
        page(Number(new URL(url).searchParams.get("page") || 1)),
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  assert.equal(result.pageCount, 2);
  assert.equal(result.complete, true);
  assert.deepEqual(urls, [base, base + "?page=2"]);
  assert.equal(
    urls.some((url) => url.includes("/denshiban/")),
    false,
  );
});
test("mismatched public metadata and unsupported canonical forms still fail identity checks", () => {
  const html = page();
  const variants = [
    page(1, "https://bunshun.jp/articles/-/93132"),
    page(1, "https://bunshun.jp/denshiban/articles/b15071?extra=1"),
    page(1, "https://bunshun.jp.evil.example/denshiban/articles/b15071"),
    html.replace('<meta property="og:url" content="' + base + '">', ""),
    html.replace(
      'content="' + base + '"',
      'content="https://bunshun.jp/articles/-/93132"',
    ),
    html.replace(
      '"@id":"' + base + '"',
      '"@id":"https://bunshun.jp/articles/-/93132"',
    ),
    html.replace(
      '"headline":"Public republication title"',
      '"headline":"Unrelated article title"',
    ),
    html.replace(
      "<h1>Public republication title</h1>",
      "<h1>Unrelated article</h1>",
    ),
    html.replace(
      "</head>",
      '<link rel="canonical" href="' + canonical + '"></head>',
    ),
    html.replace(
      "</head>",
      '<meta property="og:url" content="' + base + '"></head>',
    ),
    html.replace('type="application/ld+json"', 'type="text/plain"'),
  ];
  for (const variant of variants)
    assert.throws(() => extractBunshunPage(variant, base), /識別情報/);
  // Correct metadata must not permit a page belonging to another public article.
  assert.throws(
    () =>
      extractBunshunPage(
        html.replace(
          'href="/articles/-/93131?page=2"',
          'href="/articles/-/93132?page=2"',
        ),
        base,
      ),
    /Page link identity/,
  );
});
test("canonical identity must stay constant across pages, and mismatches return no partial body", async () => {
  await assert.rejects(
    collectBunshunArticle(base, {
      fetchPage: async (url) => {
        const n = Number(new URL(url).searchParams.get("page") || 1);
        return new Response(
          page(
            n,
            n === 1
              ? canonical
              : "https://bunshun.jp/denshiban/articles/b15072",
          ),
          { headers: { "Content-Type": "text/html" } },
        );
      },
    }),
    /ページ間/,
  );
  const response = await handleArticleRequest(
    new Request(
      "https://worker.example/article?url=" + encodeURIComponent(base),
    ),
    {},
    {
      fetchPage: async () =>
        new Response(
          page().replace(
            'content="' + base + '"',
            'content="https://bunshun.jp/articles/-/93132"',
          ),
          { headers: { "Content-Type": "text/html" } },
        ),
    },
  );
  const value = await response.json();
  assert.equal(response.status, 502);
  assert.equal(value.content, undefined);
  assert.match(value.error_message, /識別情報/);
});

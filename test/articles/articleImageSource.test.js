import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import { getAllowedBunshunImageUrl } from "../../src/domain/articles/bunshunImageUrl.js";
import { getArticleImageSource } from "../../src/domain/articles/articleImageSource.js";

const image =
  "https://bunshun.ismcdn.jp/mwimgs/d/c/1500wm/img_dcc92558a0f2d254312acb331d2a067f82737.jpg";
const worker = "https://images.example.workers.dev";
const server = "https://miniflux.example/reader";
const encode = (value) =>
  Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const signature = createHmac("sha256", "fixture-only-not-a-real-miniflux-key")
  .update(image)
  .digest();
const proxy = "/reader/proxy/" + encode(signature) + "/" + encode(image);

test("routes only the allowed direct raster URL to the Worker", () => {
  const output = new URL(getArticleImageSource(image, worker));
  assert.equal(output.origin, worker);
  assert.equal(output.pathname, "/image");
  assert.equal(output.searchParams.get("url"), image);
  assert.equal(
    getArticleImageSource(image, "http://127.0.0.1:8787").startsWith(
      "http://127.0.0.1:8787/image?",
    ),
    true,
  );
});

test("decodes official Miniflux padded Base64URL format at configured origin and base path", () => {
  for (const source of [proxy, "https://miniflux.example" + proxy]) {
    assert.equal(
      new URL(getArticleImageSource(source, worker, server)).searchParams.get(
        "url",
      ),
      image,
    );
  }
  const rootProxy = proxy.replace("/reader", "");
  assert.equal(
    new URL(
      getArticleImageSource(rootProxy, worker, "https://miniflux.example/"),
    ).searchParams.get("url"),
    image,
  );
});

test("keeps malformed, ambiguous, custom or foreign proxy URLs unchanged", () => {
  const cases = [
    proxy.replace(encode(signature), "bad"),
    proxy.replace(/=$/, ""),
    proxy + "/extra",
    proxy + "?token=not-a-real-token",
    proxy + "#fragment",
    "https://foreign.example" + proxy,
    proxy.replace("/reader", "/other"),
    proxy.replace(encode(image), encode("https://other.example/photo.jpg")),
    proxy.replace(
      encode(image),
      encode("https://bunshun.ismcdn.jp/mwimgs/a.svg"),
    ),
    proxy.replace(encode(image), encode(Buffer.from([0xff, 0xfe]))),
    proxy.replace("/reader/proxy/", "/reader/custom/"),
  ];
  for (const source of cases)
    assert.equal(getArticleImageSource(source, worker, server), source);
  assert.equal(getArticleImageSource(proxy, worker), proxy);
});

test("rejects lookalike hosts, credentials, schemes, ports, redirects-as-URLs and active formats", () => {
  const cases = [
    image.replace("bunshun.ismcdn.jp", "bunshun.ismcdn.jp.evil.example"),
    image.replace("bunshun.ismcdn.jp", "evilbunshun.ismcdn.jp"),
    image.replace("bunshun.ismcdn.jp", "bunshun.ismcdn.jp."),
    image.replace("https:", "http:"),
    image.replace("https:", "file:"),
    image.replace("https://", "https://user:password@"),
    image.replace("https://", "https://@"),
    image.replace(".jp/", ".jp:443/"),
    image.replace(".jp/", ".jp:8443/"),
    image.replace(".jpg", ".svg"),
    image.replace(".jpg", ".html"),
    image + "?url=https://other.example/",
    image + "#x",
    " " + image,
    image.replace("mwimgs/", "mwimgs/../"),
    image.replace("mwimgs/", "mwimgs/%2e%2e/"),
    image + "\n",
    image + "\r",
    "not a URL",
    "//bunshun.ismcdn.jp/mwimgs/a.jpg",
  ];
  for (const source of cases) {
    assert.equal(getAllowedBunshunImageUrl(source), null, source);
    assert.equal(getArticleImageSource(source, worker, server), source);
  }
});

test("unset or invalid Worker preserves original source and other sites are untouched", () => {
  for (const base of [
    undefined,
    "",
    "invalid",
    "http://worker.example",
    "https://user:pass@worker.example",
    "https://worker.example/path",
    "https://worker.example/?token=x",
  ]) {
    for (const source of [image, proxy, undefined])
      assert.equal(getArticleImageSource(source, base, server), source);
  }
  for (const source of [
    "https://other.example/a.jpg",
    "data:image/png;base64,AA==",
    "/local.png",
    "https://example.com/watch.mp4",
  ]) {
    assert.equal(getArticleImageSource(source, worker, server), source);
  }
  const once = getArticleImageSource(image, worker, server);
  assert.equal(getArticleImageSource(once, worker, server), once);
});

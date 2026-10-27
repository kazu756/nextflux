import { parseDocument } from "htmlparser2";
import { textContent as getText } from "domutils";
import {
  parseBunshunArticleUrl,
  MAX_BUNSHUN_PAGES,
} from "../../../src/domain/articles/bunshunArticleUrl.js";

const classes = (node) => new Set((node.attribs?.class || "").split(/\s+/));
function find(node, predicate) {
  const result = [];
  function walk(item) {
    if (predicate(item)) result.push(item);
    for (const child of item.children || []) walk(child);
  }
  walk(node);
  return result;
}
const escapeText = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text) => escapeText(text).replace(/"/g, "&quot;");
const allowed = new Set(
  "p div span section h2 h3 h4 h5 h6 strong b em i u s blockquote ul ol li figure figcaption a img br hr table thead tbody tfoot tr th td caption sub sup code pre".split(
    " ",
  ),
);
const removedClasses = new Set(
  "direct-access-info photo-icon icon-image-link btn-link-photopage ad-banner pagination article-link-area related-articles".split(
    " ",
  ),
);
const removedIds = new Set([
  "twitter-share-btn",
  "article-series-next-link",
  "read-to-end",
]);

function publicLink(value, base, image = false) {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value, base);
    if (
      url.username ||
      url.password ||
      !(image ? ["https:"] : ["https:", "http:", "mailto:"]).includes(
        url.protocol,
      )
    )
      return null;
    if (
      image &&
      (/\.svg$/i.test(url.pathname) ||
        /\/common\/images\/common\/blank\.gif$/.test(url.pathname))
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

// Rebuild an allowlisted tree. Never forward raw HTML, style, handlers or scripts.
export function sanitizeBunshunBody(node, base) {
  if (node.type === "text") return escapeText(node.data);
  const tag = node.name;
  if (
    !tag ||
    !allowed.has(tag) ||
    removedIds.has(node.attribs?.id) ||
    [...classes(node)].some((value) => removedClasses.has(value))
  )
    return "";
  if (tag === "img") {
    const src = publicLink(node.attribs?.src, base, true);
    if (!src) return "";
    return (
      '<img src="' +
      escapeAttr(src) +
      '" alt="' +
      escapeAttr((node.attribs.alt || "").slice(0, 1000)) +
      '">'
    );
  }
  let attrs = "";
  if (tag === "a") {
    const href = publicLink(node.attribs?.href, base);
    if (href)
      attrs = ' href="' + escapeAttr(href) + '" rel="noopener noreferrer"';
  }
  const content = (node.children || [])
    .map((child) => sanitizeBunshunBody(child, base))
    .join("");
  // Keep intentional emphasis while not importing the site's class/style system.
  const outputTag =
    tag === "span" && classes(node).has("bold") ? "strong" : tag;
  return (
    "<" +
    outputTag +
    attrs +
    ">" +
    content +
    (["br", "hr"].includes(tag) ? "" : "</" + outputTag + ">")
  );
}

// Public /articles/-/ pages can cite their original electronic-edition canonical.
// Accept that observed form only with independent, matching public-article metadata.
function verifyArticleIdentity(doc, expected) {
  const fail = () => {
    throw new Error(
      "記事の識別情報を確認できません（canonical / og:url / JSON-LD）。",
    );
  };
  const canonical = find(
    doc,
    (n) => n.name === "link" && n.attribs?.rel === "canonical",
  );
  if (canonical.length !== 1) return fail();
  const href = canonical[0].attribs.href;
  if (parseBunshunArticleUrl(href)?.base === expected.base)
    return expected.base;
  if (
    typeof href !== "string" ||
    href.length > 512 ||
    !/^https:\/\/bunshun\.jp\/denshiban\/articles\/b[1-9][0-9]*$/.test(href)
  )
    return fail();
  const og = find(
    doc,
    (n) => n.name === "meta" && n.attribs?.property === "og:url",
  );
  if (og.length !== 1 || og[0].attribs.content !== expected.base) return fail();
  const headings = find(doc, (n) => n.name === "h1");
  if (headings.length !== 1) return fail();
  const normalize = (value) =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const heading = normalize(getText(headings[0]));
  if (!heading) return fail();
  const articles = [];
  for (const script of find(
    doc,
    (n) => n.name === "script" && n.attribs?.type === "application/ld+json",
  )) {
    const source = getText(script);
    if (source.length > 65536) return fail();
    try {
      const data = JSON.parse(source);
      if (data && ["Article", "NewsArticle"].includes(data["@type"]))
        articles.push(data);
    } catch {
      return fail();
    }
  }
  if (
    articles.length !== 1 ||
    articles[0].mainEntityOfPage?.["@id"] !== expected.base ||
    normalize(articles[0].headline) !== heading
  )
    return fail();
  return href;
}

export function extractBunshunPage(html, requestedUrl) {
  const expected = parseBunshunArticleUrl(requestedUrl);
  if (!expected) throw new Error("Unsupported article URL");
  const doc = parseDocument(html, { decodeEntities: true });
  const identity = verifyArticleIdentity(doc, expected);
  const bodies = find(doc, (n) => classes(n).has("article-body"));
  if (bodies.length !== 1) throw new Error("Article body unavailable");
  const navigation = find(
    doc,
    (n) => classes(n).has("pagination") && classes(n).has("article"),
  );
  if (navigation.length > 1) throw new Error("Ambiguous pagination");
  const pages = new Set();
  let active = 0;
  if (navigation.length) {
    for (const anchor of find(navigation[0], (n) => n.name === "a")) {
      const text = getText(anchor).trim();
      const href = anchor.attribs?.href;
      if (/^[1-9][0-9]*$/.test(text)) {
        const page = Number(text);
        if (page > MAX_BUNSHUN_PAGES || pages.has(page))
          throw new Error("Pagination exceeds limit or repeats");
        pages.add(page);
        if (classes(anchor).has("active") && href === "#") {
          if (active) throw new Error("Repeated active page");
          active = page;
        } else {
          const url = parseBunshunArticleUrl(new URL(href, expected.base).href);
          if (url?.base !== expected.base || url.page !== page)
            throw new Error("Page link identity mismatch");
        }
      } else if (classes(anchor).has("next") || classes(anchor).has("prev")) {
        const url = parseBunshunArticleUrl(new URL(href, expected.base).href);
        const next = expected.page + (classes(anchor).has("next") ? 1 : -1);
        if (url?.base !== expected.base || url.page !== next)
          throw new Error("Invalid next or previous page");
      } else throw new Error("Unknown pagination link");
    }
    if (active !== expected.page) throw new Error("Unexpected active page");
  } else {
    if (
      expected.page !== 1 ||
      find(doc, (n) => n.name === "a" && classes(n).has("goto-next")).length
    )
      throw new Error("Pagination missing");
    pages.add(1);
  }
  const ordered = [...pages].sort((a, b) => a - b);
  if (!ordered.length || ordered.some((page, index) => page !== index + 1))
    throw new Error("Noncontiguous pagination");
  const content = (bodies[0].children || [])
    .map((node) => sanitizeBunshunBody(node, requestedUrl))
    .join("");
  const plain = getText(parseDocument(content)).trim();
  if (plain.length < 40)
    throw new Error("Article body too short or unavailable");
  return { content, pages: ordered, plain, identity };
}

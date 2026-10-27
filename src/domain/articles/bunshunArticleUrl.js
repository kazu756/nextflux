export const MAX_BUNSHUN_PAGES = 5;

export function parseBunshunArticleUrl(value) {
  if (typeof value !== "string" || value.length > 512 || /[\s\\]/.test(value))
    return null;
  const match =
    /^https:\/\/bunshun\.jp\/articles\/-\/([1-9][0-9]*)(?:\?page=([1-9][0-9]*))?$/.exec(
      value,
    );
  if (!match) return null;
  const page = Number(match[2] || 1);
  if (!Number.isSafeInteger(page) || page > MAX_BUNSHUN_PAGES) return null;
  return {
    id: match[1],
    page,
    base: "https://bunshun.jp/articles/-/" + match[1],
  };
}

export function bunshunPageUrl(base, page) {
  return page === 1 ? base : base + "?page=" + page;
}

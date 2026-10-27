// Deliberately narrower than a general URL proxy: public raster assets only.
export function getAllowedBunshunImageUrl(value) {
  if (typeof value !== "string" || value.length > 2048 || /[\s\\]/.test(value))
    return null;
  if (
    !new RegExp(
      "^https://bunshun[.]ismcdn[.]jp/mwimgs/[A-Za-z0-9/_-]+[.](?:jpe?g|png|gif|webp)$",
      "i",
    ).test(value)
  )
    return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "bunshun.ismcdn.jp" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

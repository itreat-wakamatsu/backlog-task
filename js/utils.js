function normalize(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/g, s =>
      String.fromCharCode(s.charCodeAt(0) - 0x60)
    );
}

/**
 * ページURLを正規化（クエリ・ハッシュ除去、https・末尾スラッシュ統一）。
 * 同一ページを同じキーとして扱うため。
 */
function normalizePageUrl(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "") || "/";
    return "https://" + u.hostname + path;
  } catch (_) {
    return "";
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

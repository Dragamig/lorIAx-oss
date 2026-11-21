/** Content-Disposition avec repli ASCII et filename* (RFC 5987). */
export function buildContentDisposition(filename: string, inline: boolean): string {
  const type = inline ? "inline" : "attachment";
  const ascii =
    filename
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/[\\";]/g, "_") || "file";
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET } from "@/lib/storage/s3";
import { serveContentType } from "@/lib/storage/serve-content-type";
import { buildContentDisposition } from "@/lib/media/content-disposition";

export interface ServeMediaArgs {
  req: Request;
  key: string;
  mime: string;
  filename: string;
  etagSeed: string;
  inline: boolean;
  maxAgeSeconds: number;
  /** Revalidation systématique par ETag (`no-cache`) : remplace `max-age`. */
  revalidate?: boolean;
  /** Portée du cache HTTP : "private" par défaut, "public" pour le partage sans session. */
  cacheScope?: "private" | "public";
}

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Accept-Ranges": "bytes",
} as const;

/** Range simple uniquement. null = invalide ou multiple, "unsatisfiable" = hors taille. */
function parseRange(
  header: string,
  size: number
): { start: number; end: number } | "invalid" {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || start >= size || end < start) return "invalid";
  return { start, end };
}

export async function serveMediaObject(args: ServeMediaArgs): Promise<Response> {
  const { req, key, mime, filename, etagSeed, inline, maxAgeSeconds, revalidate = false, cacheScope = "private" } = args;
  const etag = `"${etagSeed}"`;
  // H9 : le type servi est recompose cote serveur, jamais repris tel quel du stockage.
  const served = serveContentType(mime, filename);
  const disposition = buildContentDisposition(filename, inline && served.disposition === "inline");
  const common: Record<string, string> = {
    ...BASE_HEADERS,
    ETag: etag,
    "Cache-Control": revalidate ? `${cacheScope}, no-cache` : `${cacheScope}, max-age=${maxAgeSeconds}`,
  };

  let size: number;
  try {
    const head = await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    size = head.ContentLength ?? 0;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchKey") {
      return new Response(JSON.stringify({ error: "Fichier introuvable" }), {
        status: 404,
        headers: { ...BASE_HEADERS, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Erreur serveur" }), {
      status: 500,
      headers: { ...BASE_HEADERS, "Content-Type": "application/json" },
    });
  }

  const inm = req.headers.get("if-none-match");
  if (inm && inm.split(",").some((t) => t.trim() === etag || t.trim() === `W/${etag}`)) {
    return new Response(null, { status: 304, headers: common });
  }

  const rangeHeader = req.headers.get("range");
  let range: { start: number; end: number } | null = null;
  if (rangeHeader) {
    const parsed = parseRange(rangeHeader, size);
    if (parsed === "invalid") {
      return new Response(null, {
        status: 416,
        headers: { ...common, "Content-Range": `bytes */${size}` },
      });
    }
    range = parsed;
  }

  // HEAD : mêmes en-têtes que le GET, sans lire l'objet ni renvoyer de corps.
  if (req.method === "HEAD") {
    const headHeaders: Record<string, string> = {
      ...common,
      "Content-Type": served.contentType,
      "Content-Disposition": disposition,
    };
    if (range) {
      headHeaders["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
      headHeaders["Content-Length"] = String(range.end - range.start + 1);
      return new Response(null, { status: 206, headers: headHeaders });
    }
    headHeaders["Content-Length"] = String(size);
    return new Response(null, { status: 200, headers: headHeaders });
  }

  const obj = await s3Client.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
    })
  );
  const body = obj.Body as { transformToWebStream?: () => ReadableStream } | undefined;
  if (!body?.transformToWebStream) {
    return new Response(JSON.stringify({ error: "Fichier introuvable" }), {
      status: 404,
      headers: { ...BASE_HEADERS, "Content-Type": "application/json" },
    });
  }
  const stream = body.transformToWebStream();

  const headers: Record<string, string> = {
    ...common,
    "Content-Type": served.contentType,
    "Content-Disposition": disposition,
  };
  if (range) {
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
    headers["Content-Length"] = String(range.end - range.start + 1);
    return new Response(stream, { status: 206, headers });
  }
  headers["Content-Length"] = String(size);
  return new Response(stream, { status: 200, headers });
}

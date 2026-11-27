import { fileTypeFromBuffer } from "file-type";
import { OutboundRequestError, safeExternalFetch } from "@/lib/security/outbound-fetch";
import type { SessionUser } from "@/types";
import { isStockImageHost } from "@/lib/images/stock-hosts";
import { canWriteLibrary } from "./folders";
import { ingestMedia, type IngestResult } from "./ingest";
import { MAX_UPLOAD_BYTES } from "./upload-limits";
import { sanitizeFilename } from "./validate-upload";

export type RemoteOrigin = "upload" | "stock";

export type ImportRemoteInput = {
  user: SessionUser;
  orgId: string;
  spaceId: string | null;
  url: string;
  origin: RemoteOrigin;
  displayName?: string;
  /** Annulation par le client (fermeture du sélecteur) : plus rien n'est écrit une fois annulé. */
  signal?: AbortSignal;
};

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

type Failure = Extract<IngestResult, { ok: false }>;
/** `error` porte un code stable (`library.picker.errors.*` côté client), jamais un texte. */
const fail = (status: Failure["status"], error: string): Failure => ({ ok: false, status, error });

/** Nom de fichier tiré du dernier segment du chemin, sans extension. */
function baseNameFromUrl(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    // Segment mal encodé : on garde la forme brute, nettoyée ensuite.
  }
  const stem = decoded.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  const clean = sanitizeFilename(stem).replace(/\.+$/, "");
  return clean.slice(0, 80) || "image";
}

/**
 * Copie une image distante dans la médiathèque. La requête sortante passe par
 * `safeExternalFetch` (schémas, adresses privées, DNS, redirections revalidées
 * à chaque saut, taille bornée sur les octets reçus) ; le type réel vient des
 * octets, jamais de l'en-tête ni de l'extension de l'URL.
 */
export async function importRemoteImage(input: ImportRemoteInput): Promise<IngestResult> {
  const { user, orgId, spaceId, origin, signal } = input;
  const aborted = () => fail(400, "import_failed");
  if (signal?.aborted) return aborted();

  let target: URL;
  try {
    target = new URL(input.url);
  } catch {
    return fail(400, "url_refused");
  }

  // L'origine vient du client : « stock » n'est crédible que pour l'hôte d'une
  // banque d'images configurée, sinon elle servirait à contourner les contrôles.
  if (origin === "stock" && !isStockImageHost(target.hostname)) {
    return fail(400, "url_refused");
  }

  if (!(await canWriteLibrary(user, orgId))) return fail(403, "forbidden");

  let body: Buffer;
  try {
    const res = await safeExternalFetch(target.toString(), {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
      maxBytes: MAX_UPLOAD_BYTES,
      init: { headers: { Accept: "image/*" } },
    });
    if (!res.ok) return fail(400, "remote_status");
    body = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof OutboundRequestError) {
      if (err.reason === "too-large") return fail(413, "too_large");
      return fail(400, "url_refused");
    }
    return fail(400, "remote_unreachable");
  }
  if (signal?.aborted) return aborted();
  if (body.length === 0) return fail(415, "bad_type");
  if (body.length > MAX_UPLOAD_BYTES) return fail(413, "too_large");

  const detected = await fileTypeFromBuffer(body);
  if (!detected || !detected.mime.startsWith("image/")) {
    return fail(415, "bad_type");
  }

  // Dernier point d'annulation avant toute écriture (ligne `media`, puis S3) : après, pas de retour.
  if (signal?.aborted) return aborted();
  const name = `${baseNameFromUrl(target)}.${detected.ext}`;
  return ingestMedia({
    user,
    orgId,
    spaceId,
    origin,
    displayName: input.displayName,
    file: { name, size: body.length, type: detected.mime },
    buffer: body,
  });
}

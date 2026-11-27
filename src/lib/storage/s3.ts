import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  HeadObjectCommand,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  type CORSRule,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { isActiveContent, serveContentType } from "@/lib/storage/serve-content-type";

const s3Client = new S3Client({
  endpoint: `http${process.env.S3_USE_SSL === "true" ? "s" : ""}://${process.env.S3_ENDPOINT}:${process.env.S3_PORT}`,
  region: process.env.S3_REGION || "garage",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
  forcePathStyle: true,
});

/**
 * Client dédié aux URL de parts : sans somme de contrôle automatique, sinon le
 * SDK signe le CRC32 d'un corps vide dans l'URL et le stockage rejette toute
 * part réelle (InvalidDigest).
 */
const presignClient = new S3Client({
  endpoint: `http${process.env.S3_USE_SSL === "true" ? "s" : ""}://${process.env.S3_ENDPOINT}:${process.env.S3_PORT}`,
  region: process.env.S3_REGION || "garage",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
});

const BUCKET = process.env.S3_BUCKET || "loriax-files";

export async function uploadFile(
  key: string,
  body: Buffer | Uint8Array | Readable,
  contentType: string
): Promise<string> {
  if (body instanceof Readable) {
    // Upload multipart en streaming : évite de matérialiser le fichier
    // entier en mémoire (gros exports vidéo notamment).
    await new Upload({
      client: s3Client,
      params: { Bucket: BUCKET, Key: key, Body: body, ContentType: contentType },
    }).done();
    return key;
  }
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return key;
}

/** Lit l'intégralité d'un objet en mémoire. Lève une erreur si la lecture échoue. */
export async function readFileBytes(key: string): Promise<Buffer | null> {
  const res = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) return null;
  return Buffer.from(await res.Body.transformToByteArray());
}

export async function getFileUrl(
  key: string,
  expiresIn = 900,
  response?: { contentDisposition?: string; contentType?: string }
): Promise<string> {
  // H9 : les surcharges response-* sont appliquees par le stockage sur son propre
  // origine. Un type executable (SVG, HTML, XML) ne passe jamais, et la
  // disposition devient attachment : un SVG deja stocke ne s'ouvre pas en rendu.
  const keyName = key.split("/").pop() ?? key;
  const served = serveContentType(response?.contentType ?? "", keyName);
  const active = response?.contentType !== undefined && isActiveContent(response.contentType, keyName);
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(response?.contentDisposition
      ? {
          ResponseContentDisposition: active
            ? response.contentDisposition.replace(/^\s*inline/i, "attachment")
            : response.contentDisposition,
        }
      : {}),
    ...(response?.contentType
      ? { ResponseContentType: active ? served.contentType : response.contentType }
      : {}),
  });
  const signed = await getSignedUrl(s3Client, command, { expiresIn });
  return toPublicUrl(signed);
}

/**
 * Réécrit l'hôte S3 interne d'une URL signée vers `S3_PUBLIC_URL` pour que le
 * navigateur puisse la joindre (S3_ENDPOINT:S3_PORT peut être un nom Docker interne).
 */
export function toPublicUrl(signed: string): string {
  const publicUrl = process.env.S3_PUBLIC_URL;
  if (publicUrl) {
    const internalOrigin = `http${process.env.S3_USE_SSL === "true" ? "s" : ""}://${process.env.S3_ENDPOINT}:${process.env.S3_PORT}`;
    if (signed.startsWith(internalOrigin)) {
      return publicUrl.replace(/\/$/, "") + signed.slice(internalOrigin.length);
    }
  }
  return signed;
}

/**
 * Lit un objet et le rend en mémoire, ou `null` si la clé n'existe pas.
 *
 * L'absence est un cas nominal, pas une erreur : une charge utile peut n'avoir
 * jamais été écrite. Les autres erreurs S3 remontent telles quelles, pour ne
 * pas confondre « rien à lire » et « stockage en panne », confusion qui ferait
 * silencieusement repartir un utilisateur d'un document vide.
 */
export async function getFileBuffer(key: string): Promise<Buffer | null> {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key })
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as Readable) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
  } catch (err: unknown) {
    const code =
      (err as { name?: string }).name ?? (err as { Code?: string }).Code;
    if (code === "NoSuchKey" || code === "NotFound") return null;
    throw err;
  }
}

/** Variante JSON de `getFileBuffer`. `null` si la clé n'existe pas. */
export async function getFileJson<T>(key: string): Promise<T | null> {
  const buffer = await getFileBuffer(key);
  if (!buffer) return null;
  return JSON.parse(buffer.toString("utf-8")) as T;
}

/**
 * Liste les clés d'un préfixe, pagination suivie jusqu'au bout.
 *
 * Employée pour la purge des révisions : un préfixe de présentation compte
 * quelques dizaines d'objets, jamais des milliers.
 */
export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return keys;
}

/** Flux de lecture d'un objet, sans le charger en mémoire. Lève si l'objet est absent. */
export async function getFileStream(key: string): Promise<Readable> {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!response.Body) throw new Error(`Objet vide ou absent : ${key}`);
  return response.Body as Readable;
}

export async function deleteFile(key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: BUCKET, Key: key })
  );
}

/** Copie un objet du bucket vers une autre clé, côté serveur S3 (sans transit en mémoire). */
export async function copyFile(srcKey: string, dstKey: string): Promise<void> {
  const source = `${BUCKET}/${srcKey.split("/").map(encodeURIComponent).join("/")}`;
  await s3Client.send(new CopyObjectCommand({ Bucket: BUCKET, Key: dstKey, CopySource: source }));
}

/** Ouvre un envoi multipart ; l'identifiant S3 de la session est rendu. */
export async function createMultipart(key: string, contentType: string): Promise<string> {
  const res = await s3Client.send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
  );
  if (!res.UploadId) throw new Error("Session multipart sans identifiant");
  return res.UploadId;
}

/**
 * URL signée (PUT) d'une part, sur l'hôte public. Durée courte : 15 minutes par
 * défaut. `contentLength` est signé : le stockage refuse un corps de taille
 * différente (une part ne peut pas dépasser ce qui a été réservé au quota).
 */
export async function presignUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  contentLength?: number,
  expiresIn = 900,
): Promise<string> {
  const command = new UploadPartCommand({
    Bucket: BUCKET,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
    ...(contentLength === undefined ? {} : { ContentLength: contentLength }),
  });
  return toPublicUrl(
    await getSignedUrl(presignClient, command, {
      expiresIn,
      ...(contentLength === undefined ? {} : { unhoistableHeaders: new Set(["content-length"]) }),
    }),
  );
}

/** Parts déjà reçues, pagination suivie jusqu'au bout. */
export async function listUploadedParts(
  key: string,
  uploadId: string,
): Promise<{ partNumber: number; etag: string; size: number }[]> {
  const parts: { partNumber: number; etag: string; size: number }[] = [];
  let marker: string | undefined;
  do {
    const page = await s3Client.send(
      new ListPartsCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumberMarker: marker }),
    );
    for (const p of page.Parts ?? []) {
      if (p.PartNumber && p.ETag) parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size ?? 0 });
    }
    marker = page.IsTruncated && page.NextPartNumberMarker ? String(page.NextPartNumberMarker) : undefined;
  } while (marker);
  return parts;
}

export async function completeMultipart(
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> {
  await s3Client.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: [...parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    }),
  );
}

/** Abandonne une session ; une session déjà disparue n'est pas une erreur. */
export async function abortMultipart(key: string, uploadId: string): Promise<void> {
  try {
    await s3Client.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }));
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchUpload") return;
    throw err;
  }
}

/** Sessions multipart en cours dans le bucket (pour le balayage des orphelines), pagination suivie jusqu'au bout. */
export async function listMultipartUploads(): Promise<{ key: string; uploadId: string; initiated: Date }[]> {
  const out: { key: string; uploadId: string; initiated: Date }[] = [];
  let keyMarker: string | undefined;
  let idMarker: string | undefined;
  do {
    const page = await s3Client.send(
      new ListMultipartUploadsCommand({ Bucket: BUCKET, KeyMarker: keyMarker, UploadIdMarker: idMarker }),
    );
    for (const u of page.Uploads ?? []) {
      if (u.Key && u.UploadId && u.Initiated) out.push({ key: u.Key, uploadId: u.UploadId, initiated: u.Initiated });
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    idMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
  } while (keyMarker);
  return out;
}

/** Taille réelle d'un objet, ou `null` s'il n'existe pas. */
export async function headObject(key: string): Promise<{ size: number } | null> {
  try {
    const res = await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return { size: res.ContentLength ?? 0 };
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/** Lecture d'une plage d'octets (bornes incluses). */
export async function getObjectRange(key: string, start: number, end: number): Promise<Buffer> {
  const res = await s3Client.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: `bytes=${start}-${end}` }),
  );
  if (!res.Body) return Buffer.alloc(0);
  return Buffer.from(await res.Body.transformToByteArray());
}

const MULTIPART_CORS_ID = "loriax-app-multipart";

/**
 * Ajoute (sans rien retirer d'autre) les règles CORS d'envoi direct : PUT, GET,
 * HEAD, en-tête `ETag` exposé, UNE règle par origine. Garage renvoie en effet
 * toute la liste d'une règle multi-origines dans `Access-Control-Allow-Origin`
 * (valeur invalide pour un navigateur) et ne sait pas apparier un joker de
 * sous-domaine : une origine exacte par règle est la seule forme sûre partout.
 * Les règles dont l'ID commence par `loriax-app-multipart` sont recalculées
 * (idempotent), les autres conservées telles quelles. Fonction pure.
 */
export function mergeMultipartCors(existing: CORSRule[], origins: string | string[]): { rules: CORSRule[]; changed: boolean } {
  const list = [...new Set(Array.isArray(origins) ? origins : [origins])];
  const wanted: CORSRule[] = list.map((origin, i) => ({
    ID: i === 0 ? MULTIPART_CORS_ID : `${MULTIPART_CORS_ID}-${origin}`,
    AllowedOrigins: [origin],
    AllowedMethods: ["PUT", "GET", "HEAD"],
    AllowedHeaders: ["*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  }));
  const ours = (r: CORSRule) => r.ID?.startsWith(MULTIPART_CORS_ID) ?? false;
  const key = (r: CORSRule) =>
    JSON.stringify([r.ID, r.AllowedOrigins, r.AllowedMethods, r.AllowedHeaders, r.ExposeHeaders]);
  const current = existing.filter(ours);
  const same = current.length === wanted.length && wanted.every((w, i) => key(w) === key(current[i]));
  if (same) return { rules: existing, changed: false };
  return { rules: [...existing.filter((r) => !ours(r)), ...wanted], changed: true };
}

const ORG_SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Origines autorisées : l'URL publique de l'app ; si les organisations sont
 * servies en sous-domaines (NEXT_PUBLIC_ROOT_DOMAIN, voir `buildOrgUrl`), chaque
 * `https://<slug>.<racine>` connu (règles exactes, Garage n'apparie pas les
 * jokers de sous-domaine). Jamais de joker.
 */
export function multipartCorsOrigins(
  appUrl: string | undefined,
  rootDomain: string | undefined,
  orgSlugs: string[] = [],
): string[] {
  if (!appUrl) return [];
  const origins = [new URL(appUrl).origin];
  const root = (rootDomain ?? "").trim().toLowerCase();
  if (/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(root)) {
    for (const slug of orgSlugs) {
      if (ORG_SLUG_RE.test(slug)) origins.push(`https://${slug}.${root}`);
    }
  }
  return [...new Set(origins)];
}

/** Pose les règles CORS d'envoi direct sur le bucket (`orgSlugs` : organisations en sous-domaine). */
export async function ensureBucketCors(orgSlugs: string[] = []): Promise<"updated" | "unchanged" | "skipped"> {
  const origin = multipartCorsOrigins(
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL,
    process.env.NEXT_PUBLIC_ROOT_DOMAIN,
    orgSlugs,
  );
  if (origin.length === 0) return "skipped";
  let existing: CORSRule[] = [];
  try {
    const res = await s3Client.send(new GetBucketCorsCommand({ Bucket: BUCKET }));
    existing = res.CORSRules ?? [];
  } catch (err) {
    if ((err as { name?: string }).name !== "NoSuchCORSConfiguration") throw err;
  }
  const { rules, changed } = mergeMultipartCors(existing, origin);
  if (!changed) return "unchanged";
  await s3Client.send(new PutBucketCorsCommand({ Bucket: BUCKET, CORSConfiguration: { CORSRules: rules } }));
  return "updated";
}

export { s3Client, BUCKET };


import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
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

  // Rewrite internal S3 endpoint to public URL so browsers can load the file.
  // S3_ENDPOINT:S3_PORT may be a Docker-internal hostname unreachable from outside.
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

export async function deleteFile(key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: BUCKET, Key: key })
  );
}

export { s3Client, BUCKET };


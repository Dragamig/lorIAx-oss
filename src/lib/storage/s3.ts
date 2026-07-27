import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

export interface UploadOptions {
  /**
   * Content-Disposition stored on the object. Set it to "attachment" for formats the
   * browser could otherwise execute on the storage origin (SVG, XML), so that even a
   * presigned URL opened directly triggers a download instead of a render.
   */
  contentDisposition?: string;
}

export async function uploadFile(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
  options: UploadOptions = {}
): Promise<string> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentDisposition: options.contentDisposition,
    })
  );
  return key;
}

export async function getFileUrl(key: string, expiresIn = 900): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn });
}

export async function deleteFile(key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: BUCKET, Key: key })
  );
}

export { s3Client, BUCKET };

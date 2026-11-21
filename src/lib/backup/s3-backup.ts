import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { z } from "zod";

export interface BackupS3Config {
  s3BackupEndpoint: string;
  s3BackupPort: string;
  s3BackupRegion: string;
  s3BackupBucket: string;
  s3BackupAccessKey: string;
  s3BackupSecretKey: string;
  s3BackupUseSsl: boolean;
}

const BackupS3ConfigSchema = z.object({
  s3BackupEndpoint: z.string(),
  s3BackupPort: z.string(),
  s3BackupRegion: z.string(),
  s3BackupBucket: z.string(),
  s3BackupAccessKey: z.string(),
  s3BackupSecretKey: z.string(),
  s3BackupUseSsl: z.boolean(),
});

export async function getBackupS3Config(): Promise<BackupS3Config | null> {
  const row = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, "backup_s3"))
    .then((rows) => rows[0]);

  if (!row?.value) return null;

  const config = BackupS3ConfigSchema.parse(row.value);
  if (!config.s3BackupEndpoint || !config.s3BackupAccessKey || !config.s3BackupSecretKey) {
    return null;
  }

  return config;
}

export async function createBackupS3Client(): Promise<{ client: S3Client; bucket: string } | null> {
  const config = await getBackupS3Config();
  if (!config) return null;

  let secretKey = config.s3BackupSecretKey;
  // Decrypt if encrypted (format: iv:authTag:ciphertext in hex)
  if (/^[0-9a-f]{32}:[0-9a-f]{32}:/.test(secretKey)) {
    try {
      secretKey = decrypt(secretKey);
    } catch (err) {
      console.error('Failed to decrypt backup S3 secret');
      return null;
    }
  }

  const protocol = config.s3BackupUseSsl ? "https" : "http";
  const port = config.s3BackupPort ? `:${config.s3BackupPort}` : "";
  const endpoint = `${protocol}://${config.s3BackupEndpoint}${port}`;

  const client = new S3Client({
    endpoint,
    region: config.s3BackupRegion || "us-east-1",
    credentials: {
      accessKeyId: config.s3BackupAccessKey,
      secretAccessKey: secretKey,
    },
    forcePathStyle: true,
  });

  return { client, bucket: config.s3BackupBucket };
}

export async function testBackupS3Connection(): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await createBackupS3Client();
    if (!result) {
      return { success: false, error: "Configuration S3 de sauvegarde manquante" };
    }

    await result.client.send(new HeadBucketCommand({ Bucket: result.bucket }));
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return { success: false, error: message };
  }
}

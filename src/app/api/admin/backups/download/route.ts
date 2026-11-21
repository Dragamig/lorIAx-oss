import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole, INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { backupJobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createBackupS3Client } from "@/lib/backup/s3-backup";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  // Portée instance : l'URL présignée rendue ici mène à un dump PostgreSQL
  // complet, contenant les données de toutes les organisations. Un admin
  // d'organisation y lirait les autres tenants (audit du 2026-08-19, AZ-07).
  if (!user || !hasGlobalRole(user.globalRole, "super_admin")) {
    return NextResponse.json(
      { error: INSTANCE_ADMIN_ONLY_MESSAGE },
      { status: 403 }
    );
  }

  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId requis" }, { status: 400 });
  }

  const [job] = await db
    .select()
    .from(backupJobs)
    .where(eq(backupJobs.id, jobId))
    .limit(1);

  if (!job) {
    return NextResponse.json({ error: "Sauvegarde introuvable" }, { status: 404 });
  }

  if (job.status !== "completed" || !job.s3Key) {
    return NextResponse.json({ error: "Sauvegarde non disponible au téléchargement" }, { status: 400 });
  }

  const s3 = await createBackupS3Client();
  if (!s3) {
    return NextResponse.json({ error: "Configuration S3 manquante" }, { status: 500 });
  }

  const command = new GetObjectCommand({
    Bucket: job.s3Bucket || s3.bucket,
    Key: job.s3Key,
  });

  try {
    const url = await getSignedUrl(s3.client, command, { expiresIn: 900 });
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: 'Erreur génération URL' }, { status: 500 });
  }
}

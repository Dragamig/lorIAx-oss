import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole, INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { backupJobs } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { getBackupS3Config } from "@/lib/backup/s3-backup";

export async function GET() {
  const user = await getSessionUser();
  // Portée instance : cet état porte sur les dumps multi-tenants de
  // l'instance et sur sa configuration S3 (audit du 2026-08-19, AZ-07).
  if (!user || !hasGlobalRole(user.globalRole, "super_admin")) {
    return NextResponse.json(
      { error: INSTANCE_ADMIN_ONLY_MESSAGE },
      { status: 403 }
    );
  }

  // Running jobs
  const running = await db
    .select()
    .from(backupJobs)
    .where(eq(backupJobs.status, "running"))
    .orderBy(desc(backupJobs.startedAt));

  // Last completed per type
  const types = ["client", "technical", "full"] as const;
  const lastCompleted: Record<string, typeof backupJobs.$inferSelect | null> = {};

  for (const type of types) {
    const [job] = await db
      .select()
      .from(backupJobs)
      .where(and(eq(backupJobs.type, type), eq(backupJobs.status, "completed")))
      .orderBy(desc(backupJobs.startedAt))
      .limit(1);
    lastCompleted[type] = job ?? null;
  }

  const s3Config = await getBackupS3Config();

  return NextResponse.json({
    running,
    lastCompleted,
    s3Configured: !!s3Config,
  });
}

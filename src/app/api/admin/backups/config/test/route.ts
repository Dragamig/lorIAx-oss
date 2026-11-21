import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole, INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";
import { testBackupS3Connection } from "@/lib/backup/s3-backup";

export async function POST() {
  const user = await getSessionUser();
  // Portée instance : le test de connexion expose la destination S3 où
  // atterrissent les dumps multi-tenants de l'instance (audit du 2026-08-19,
  // AZ-07).
  if (!user || !hasGlobalRole(user.globalRole, "super_admin")) {
    return NextResponse.json(
      { error: INSTANCE_ADMIN_ONLY_MESSAGE },
      { status: 403 }
    );
  }

  const result = await testBackupS3Connection();
  return NextResponse.json(result);
}

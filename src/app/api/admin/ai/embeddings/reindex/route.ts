import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import {
  getReindexStatus,
  runEmbeddingReindex,
} from "@/lib/ai/embedding-reindex";

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return null;
  }
  return user;
}

/** Statut courant de la ré-indexation (polling UI). */
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }
  const status = await getReindexStatus();
  return NextResponse.json(status);
}

/**
 * Lance une ré-indexation complète (migration des colonnes vectorielles si la
 * dimension change + ré-indexation KB + documents). Job en arrière-plan
 * (fire-and-forget) ; renvoie immédiatement. Anti-double-lancement.
 */
export async function POST() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const status = await getReindexStatus();
  if (status.running) {
    return NextResponse.json({ running: true });
  }

  // Fire-and-forget : runEmbeddingReindex ne lève jamais (erreurs → statut).
  void runEmbeddingReindex();

  return NextResponse.json({ started: true });
}

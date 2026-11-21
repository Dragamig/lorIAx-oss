import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole, INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";
import { detectModels } from "@/lib/ai/detect-models";

/**
 * Détection de modèles sur une URL et une clé d'API fournies dans le CORPS de
 * la requête : la route émet une requête sortante vers une cible choisie par
 * l'appelant et lui relaie le résultat. Depuis l'ADR-079 (2026-08-20),
 * `admin` n'est plus un rôle d'instance, donc la laisser ouverte à ce rôle
 * revenait à donner un scanner de réseau interne à tout administrateur
 * d'organisation. Réservée à `super_admin`.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "super_admin")) {
    return NextResponse.json(
      { error: INSTANCE_ADMIN_ONLY_MESSAGE },
      { status: 403 }
    );
  }

  const { apiBaseUrl, apiKey, connectorType } = await request.json();

  const result = await detectModels({ connectorType, apiBaseUrl, apiKey });

  if (result.models.length === 0) {
    return NextResponse.json(
      { error: result.error || "Impossible de récupérer la liste des modèles" },
      { status: 502 }
    );
  }

  return NextResponse.json({ models: result.models, details: result.details });
}

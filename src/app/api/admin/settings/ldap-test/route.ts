import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { canCrossOrgBoundary, INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";
import { testLdapConnection } from "@/lib/auth/ldap";

/**
 * AZ-08, porte dérobée par l'exercice de la configuration.
 *
 * La clé `ldap` (annuaire d'entreprise et compte de service de lecture) est
 * réservée à l'administration d'instance depuis AZ-08. Cette route la faisait
 * encore exercer : une liaison réelle à l'annuaire avec le compte de service,
 * dont le message d'erreur renvoyé tel quel renseigne sur l'hôte et sur la
 * validité du couple DN/mot de passe. Oracle de connexion sur une ressource
 * d'instance, donc même frontière de rôle.
 *
 * Les paramètres viennent de la base (`testLdapConnection` relit
 * `system_settings`) : la route n'accepte aucun corps, donc aucun identifiant
 * fourni par l'appelant, et il ne faut pas en accepter.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user || !canCrossOrgBoundary(user.globalRole)) {
    return NextResponse.json(
      { error: INSTANCE_ADMIN_ONLY_MESSAGE },
      { status: 403 }
    );
  }

  const result = await testLdapConnection();

  if (result.success) {
    return NextResponse.json({ message: "Connexion LDAP réussie" });
  }

  return NextResponse.json(
    { error: `Échec de la connexion LDAP : ${result.error}` },
    { status: 500 }
  );
}

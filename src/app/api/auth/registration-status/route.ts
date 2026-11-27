import { NextResponse } from "next/server";
import { getRegistrationRefusal } from "@/lib/auth/registration-policy";
import { isRegistrationOpen } from "@/lib/auth/registration-setting";

export const dynamic = "force-dynamic";

/**
 * Public : indique si l'inscription libre est ouverte (masque le lien de la
 * page de connexion). Ouverte seulement si le reglage est explicitement `true`
 * (fail-closed) ET que la politique d'edition ne refuse pas (instance oss non
 * amorcee, etc.), comme `/api/auth/register`.
 */
export async function GET() {
  let open = false;
  try {
    open = (await isRegistrationOpen()) && (await getRegistrationRefusal()) === null;
  } catch {
    open = false;
  }
  return NextResponse.json({ open }, { headers: { "Cache-Control": "no-store" } });
}

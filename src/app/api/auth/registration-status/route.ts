import { NextResponse } from "next/server";
import { getRegistrationRefusal } from "@/lib/auth/registration-policy";

/** Public : indique si l'inscription libre est ouverte (masque le lien de la page de connexion). */
export async function GET() {
  const refusal = await getRegistrationRefusal();
  return NextResponse.json({ open: refusal === null });
}

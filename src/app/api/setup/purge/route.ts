import { NextResponse } from "next/server";
import { purgeAllData } from "@/lib/setup/purge";
import { guardSetupAccess } from "@/lib/setup/guards";

export async function POST() {
  const access = await guardSetupAccess();
  if (!access.allowed) return access.response;

  try {
    await purgeAllData();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[setup/purge] Erreur lors de la purge :", error);
    return NextResponse.json(
      { error: "Erreur lors de la suppression des données" },
      { status: 500 }
    );
  }
}

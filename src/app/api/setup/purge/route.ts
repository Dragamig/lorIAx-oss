import { NextRequest, NextResponse } from "next/server";
import { purgeAllData } from "@/lib/setup/purge";
import { guardSetupRoute } from "@/lib/setup/guards";

export async function POST(request: NextRequest) {
  const blocked = await guardSetupRoute(request);
  if (blocked) return blocked;

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

// src/app/api/setup/skip/route.ts
import { NextResponse } from "next/server";
import {
  clearWizardTicket,
  guardSetupAccess,
  hasAnyUser,
  markSetupCompleted,
} from "@/lib/setup/guards";

export async function POST() {
  const access = await guardSetupAccess();
  if (!access.allowed) return access.response;

  // « Plus tard » ferme le wizard pour de bon : sans cela, une instance seedée
  // ou restaurée resterait indéfiniment ouverte, le drapeau n'étant écrit que
  // par /api/setup/complete.
  // Exception : sur une instance encore vierge (aucun compte), poser le drapeau
  // condamnerait l'instance, plus de wizard et personne pour se connecter. On se
  // contente alors du cookie de report à 24 h.
  if (await hasAnyUser()) {
    await markSetupCompleted();
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set("setup_skipped", "1", {
    path: "/",
    maxAge: 86400, // 24h
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  return clearWizardTicket(response);
}

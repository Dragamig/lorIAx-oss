// src/app/api/setup/skip/route.ts
import { NextRequest, NextResponse } from "next/server";
import { guardSetupRoute } from "@/lib/setup/guards";

export async function POST(request: NextRequest) {
  const blocked = await guardSetupRoute(request);
  if (blocked) return blocked;

  const response = NextResponse.json({ success: true });
  response.cookies.set("setup_skipped", "1", {
    path: "/",
    maxAge: 86400, // 24h
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  return response;
}

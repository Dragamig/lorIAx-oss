import "server-only";
import { NextResponse } from "next/server";
import { TALLY_FORM_REQUIRED_CODE } from "./tally-activation-guard";

/** Réponse 422 commune aux routes : message français et code stable pour la traduction côté interface. */
export function tallyFormRequiredResponse(): NextResponse {
  return NextResponse.json(
    { error: "Choisissez un formulaire Tally avant d'activer cet automatisme", code: TALLY_FORM_REQUIRED_CODE },
    { status: 422 },
  );
}

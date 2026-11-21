// src/app/api/setup/authorize/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  SETUP_COOKIE_MAX_AGE,
  SETUP_TOKEN_COOKIE,
  requireBootstrapToken,
} from "@/lib/setup/bootstrap-token";
import { guardSetupNotCompleted } from "@/lib/setup/guards";

/**
 * Échange du jeton d'amorçage contre un cookie de session d'installation
 * (constat AZ-28). L'exploitant saisit une seule fois le jeton lu dans les
 * journaux du conteneur.
 *
 * Le cookie n'est qu'un CONFORT : il évite de ressaisir le jeton après un
 * rechargement quand le navigateur l'accepte. L'autorisation qui fait foi est
 * l'en-tête `x-setup-token`, que le client rejoue sur chaque appel (cf.
 * `src/lib/setup/client.ts`), car un cookie posé sur une instance ouverte en
 * HTTP nu peut parfaitement être jeté sans que rien ne le signale.
 *
 * Le jeton n'est PAS consommé ici : il ne l'est qu'à la fin de l'assistant,
 * pour qu'un échec en cours de parcours ne condamne pas l'installation.
 */
export async function POST(request: NextRequest) {
  let candidate = "";
  try {
    const body = await request.json();
    const value = (body as { token?: unknown })?.token;
    if (typeof value === "string") candidate = value.trim();
  } catch {
    candidate = "";
  }

  const refused = await requireBootstrapToken(request, { candidate });
  if (refused) return refused;

  const completed = await guardSetupNotCompleted();
  if (completed) return completed;

  const response = NextResponse.json({ authorized: true });

  // `secure` se décide sur le protocole RÉELLEMENT servi, pas sur `NODE_ENV`.
  // Une instance auto-hébergée en conteneur tourne en production tout en étant
  // ouverte en HTTP nu avant la mise en place de TLS : marquer le cookie
  // `secure` dans ce cas le fait jeter par le navigateur, sans le moindre
  // message. L'autorisation ne repose de toute façon plus sur ce cookie, qui
  // n'est qu'un confort, mais il n'y a aucune raison de le poser inutilisable.
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const proto = forwardedProto
    ? forwardedProto.split(",")[0].trim().toLowerCase()
    : new URL(request.url).protocol.replace(":", "");
  const surHttps = proto === "https";

  response.cookies.set(SETUP_TOKEN_COOKIE, candidate, {
    path: "/",
    maxAge: SETUP_COOKIE_MAX_AGE,
    httpOnly: true,
    secure: surHttps,
    sameSite: "strict",
  });
  return response;
}

/**
 * État de l'autorisation courante, pour que l'assistant n'affiche l'écran de
 * déverrouillage que lorsqu'il est nécessaire (rechargement de page en cours
 * de parcours, par exemple).
 *
 * Le client interroge aussi cette route APRÈS le POST, en présentant son jeton
 * par l'en-tête : un 200 sur le POST ne prouve pas que le navigateur a
 * conservé le cookie, alors qu'une réponse `authorized` obtenue sur un appel
 * ultérieur prouve que le parcours ira jusqu'au bout.
 */
export async function GET(request: NextRequest) {
  const refused = await requireBootstrapToken(request);
  return NextResponse.json({ authorized: refused === null });
}

import { jwtVerify } from "jose";
import { db } from "@/lib/db";
import { users, spacePermissions, documents, spaces } from "@/lib/db/schema";
import { eq, and, or } from "drizzle-orm";
import { canViewByClassification } from "@/lib/auth/rbac";
import type { ClassificationLevel } from "@/lib/auth/classification";
import logger from "@/lib/logger";

interface WsUser {
  id: string;
  email: string;
  name: string;
  globalRole: string;
  avatarUrl: string | null;
  /**
   * Organisation portée par le jeton, résolue côté serveur au moment de la
   * signature (là où l'en-tête `x-org-slug` existe encore). Jamais déclarée
   * par le client. `null` = jeton émis avant le cloisonnement WebSocket : la
   * connexion doit être refusée (fail-closed), le client demande un jeton neuf.
   */
  orgId: string | null;
}

/**
 * Verify a JWT token from WebSocket connection and return user info.
 */
export async function verifyWsToken(token: string): Promise<WsUser | null> {
  try {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      logger.error("NEXTAUTH_SECRET not set");
      return null;
    }

    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);

    const userId = payload.id as string | undefined;
    if (!userId) return null;

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        globalRole: users.globalRole,
        avatarUrl: users.avatarUrl,
        tokenInvalidatedAt: users.tokenInvalidatedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return null;

    // Vérifier si le token a été émis avant une invalidation (changement mdp/rôle)
    if (user.tokenInvalidatedAt && payload.iat) {
      const tokenIssuedAt = payload.iat * 1000; // JWT iat en secondes → ms
      if (tokenIssuedAt < user.tokenInvalidatedAt.getTime()) {
        logger.warn({ userId }, "WebSocket token invalidated (issued before credential change)");
        return null;
      }
    }

    const orgId = typeof payload.orgId === "string" ? payload.orgId : null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      globalRole: user.globalRole,
      avatarUrl: user.avatarUrl,
      orgId,
    };
  } catch (err) {
    logger.error({ err }, "JWT verification failed (WebSocket)");
    return null;
  }
}

/**
 * Contrôle d'accès en lecture **réservé au canal WebSocket de collaboration**
 * (Hocuspocus / Yjs).
 *
 * Applique le même cloisonnement multi-tenant que `checkDocumentViewAccess`
 * de `@/lib/auth/check-access` : l'espace du document doit appartenir à
 * l'organisation `orgId`, y compris pour les rôles `admin` / `super_admin`
 * (un admin de l'org A ne voit pas les documents de l'org B). Le bypass admin
 * ne joue plus que **à l'intérieur** de l'organisation du jeton.
 *
 * L'organisation n'est pas résolue ici : le contexte WebSocket n'a pas de
 * requête HTTP Next.js, donc pas d'en-tête `x-org-slug`, et `getRequestOrgId()`
 * n'y est pas appelable. Elle est résolue côté serveur au moment de la
 * signature du jeton de connexion et transportée dans sa charge utile signée
 * (cf. {@link verifyWsToken}).
 *
 * `orgId` absent (jeton émis avant ce cloisonnement) ⇒ refus : le client doit
 * redemander un jeton à `/api/auth/ws-token`.
 *
 * → Toute route HTTP doit utiliser `checkDocumentViewAccess`, jamais ce helper.
 */
export async function checkDocumentAccess(
  userId: string,
  documentId: string,
  globalRole: string,
  orgId: string | null
): Promise<boolean> {
  // Fail-closed : un jeton sans organisation n'ouvre aucun document
  if (!orgId) {
    logger.warn({ userId, documentId }, "[auth-ws] Jeton sans organisation — accès refusé");
    return false;
  }

  // Get the document + space info (including classification and org)
  const [doc] = await db
    .select({
      spaceId: documents.spaceId,
      createdBy: documents.createdBy,
      classification: documents.classification,
      organizationId: spaces.organizationId,
    })
    .from(documents)
    .innerJoin(spaces, eq(spaces.id, documents.spaceId))
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) {
    logger.warn({ userId, documentId }, "[auth-ws] Document not found");
    return false;
  }

  // Cloisonnement multi-tenant — vaut aussi pour les admins globaux
  if (doc.organizationId !== orgId) {
    logger.warn(
      { userId, documentId, orgId },
      "[auth-ws] Document hors de l'organisation du jeton — accès refusé"
    );
    return false;
  }

  // Admins have access to everything **within their organization**
  if (globalRole === "super_admin" || globalRole === "admin") {
    logger.info({ userId, globalRole, orgId }, "[auth-ws] Admin bypass (intra-org) — access granted");
    return true;
  }

  logger.info({ userId, documentId, spaceId: doc.spaceId, createdBy: doc.createdBy, classification: doc.classification }, "[auth-ws] Document found, checking permissions...");

  // Check space permissions
  const [perm] = await db
    .select({ level: spacePermissions.level })
    .from(spacePermissions)
    .where(
      and(
        eq(spacePermissions.spaceId, doc.spaceId),
        or(eq(spacePermissions.userId, userId))
      )
    )
    .limit(1);

  const isSpaceMember = !!perm;
  const isSpaceAdmin = perm?.level === "admin";
  const isDocumentAuthor = doc.createdBy === userId;

  // Classification check — blocks access to secret docs for non-privileged users
  if (doc.classification) {
    const canView = canViewByClassification(
      doc.classification as ClassificationLevel,
      {
        isAuthenticated: true,
        isSpaceMember,
        isSpaceAdmin,
        isDocumentAuthor,
        userGlobalRole: globalRole as "viewer" | "editor" | "admin" | "super_admin",
      }
    );
    if (!canView) return false;
  }

  // Document creator always has access
  if (isDocumentAuthor) return true;

  return isSpaceMember;
}

/**
 * Contrôle d'accès en écriture **réservé au canal WebSocket de collaboration**
 * (Hocuspocus / Yjs) et à la synchronisation Markdown qui en découle.
 *
 * ATTENTION — ce helper n'est PAS l'équivalent de `checkDocumentEditAccess`
 * exporté par `@/lib/auth/check-access` : il ne lit pas les permissions
 * document (`document_permissions`) et raisonne uniquement sur l'espace.
 *
 * Il applique en revanche le **même cloisonnement multi-tenant** : l'espace du
 * document doit appartenir à l'organisation `orgId` portée par le jeton de
 * connexion, y compris pour les rôles `admin` / `super_admin` (un admin de
 * l'org A n'écrit pas dans les documents de l'org B). Le bypass admin ne joue
 * plus que **à l'intérieur** de cette organisation.
 *
 * L'organisation vient du jeton signé (cf. {@link verifyWsToken}) : le contexte
 * WebSocket n'a pas d'en-tête `x-org-slug`, donc `getRequestOrgId()` n'y est
 * pas appelable ; elle est résolue à l'émission du jeton, côté HTTP.
 * `orgId` absent (jeton antérieur au cloisonnement) ⇒ refus (fail-closed).
 *
 * → Toute route HTTP doit utiliser `checkDocumentEditAccess` de
 *   `@/lib/auth/check-access`, jamais cette variante.
 *
 * Relit `globalRole` en base pour détecter un changement de rôle depuis
 * l'ouverture de la connexion WS. Exige au moins le niveau "editor" sur
 * l'espace (pas simplement viewer/membre).
 */
export async function checkCollabDocumentEditAccess(
  userId: string,
  documentId: string,
  orgId: string | null
): Promise<boolean> {
  // Fail-closed : un jeton sans organisation n'écrit dans aucun document
  if (!orgId) {
    logger.warn({ userId, documentId }, "[auth-ws] Jeton sans organisation — écriture refusée");
    return false;
  }

  // Fetch current globalRole from DB (may have changed since WS connection)
  const [user] = await db
    .select({ globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return false;

  // Get the document info (+ organisation de l'espace)
  const [doc] = await db
    .select({
      spaceId: documents.spaceId,
      createdBy: documents.createdBy,
      organizationId: spaces.organizationId,
    })
    .from(documents)
    .innerJoin(spaces, eq(spaces.id, documents.spaceId))
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) return false;

  // Cloisonnement multi-tenant — vaut aussi pour les admins globaux
  if (doc.organizationId !== orgId) {
    logger.warn(
      { userId, documentId, orgId },
      "[auth-ws] Document hors de l'organisation du jeton — écriture refusée"
    );
    return false;
  }

  // Admins can always edit **within their organization**
  if (user.globalRole === "super_admin" || user.globalRole === "admin") {
    return true;
  }

  // Pas de raccourci « auteur » en écriture : la permission d'espace prime sur
  // l'auteur (décision du 2026-08-20), comme dans `checkDocumentEditAccess`.
  // Un auteur rétrogradé viewer ne peut plus écrire dans le canal Yjs.

  // Check space permission — require at least "editor" level
  const [perm] = await db
    .select({ level: spacePermissions.level })
    .from(spacePermissions)
    .where(
      and(
        eq(spacePermissions.spaceId, doc.spaceId),
        eq(spacePermissions.userId, userId)
      )
    )
    .limit(1);

  if (!perm) return false;

  // "admin" and "editor" can edit, "viewer" cannot
  return perm.level === "admin" || perm.level === "editor";
}

import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { documents, spaces, documentLinks, systemSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkDocumentViewAccess } from "@/lib/auth/check-access";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { readDocument } from "@/lib/storage/filesystem";
import { SignJWT } from "jose";
import DocumentPageClient from "./document-page-client";

// PERF-12 — Server Component : pré-charge le document et le ws-token
// Élimine le round-trip client → API → DB (gain ~50% sur le temps d'affichage initial)
export default async function DocumentPage({
  params,
}: {
  params: Promise<{ spaceSlug: string; docId: string }>;
}) {
  const { spaceSlug, docId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Charger document + space + backlinks en parallèle
  const [docResult, backlinkRows] = await Promise.all([
    db.select().from(documents).where(eq(documents.id, docId)).limit(1),
    db
      .select({
        sourceId: documentLinks.sourceId,
        linkText: documentLinks.linkText,
        title: documents.title,
        slug: documents.slug,
      })
      .from(documentLinks)
      .innerJoin(documents, eq(documentLinks.sourceId, documents.id))
      .where(eq(documentLinks.targetId, docId)),
  ]);

  const doc = docResult[0];
  if (!doc) notFound();

  const canView = await checkDocumentViewAccess(user, doc.spaceId, doc.id);
  if (!canView) notFound();

  // Charger l'espace (nécessaire pour le contenu filesystem + classification)
  const [space] = await db
    .select()
    .from(spaces)
    .where(eq(spaces.id, doc.spaceId))
    .limit(1);

  // Check if collaboration is enabled (admin setting)
  const collabSetting = await db.select().from(systemSettings).where(eq(systemSettings.key, "collab")).limit(1);
  const collabEnabled = collabSetting[0]?.value
    ? (collabSetting[0].value as { collabEnabled?: boolean }).collabEnabled !== false
    : true; // default: enabled

  // Lire le contenu + générer le ws-token en parallèle
  const wsSecret = process.env.NEXTAUTH_SECRET;
  if (!wsSecret) {
    throw new Error("NEXTAUTH_SECRET est obligatoire pour signer les tokens WebSocket");
  }
  // Organisation courante (sous-domaine) embarquée dans le jeton WebSocket :
  // le canal Hocuspocus n'a pas d'en-tête `x-org-slug` et ne peut la résoudre.
  // checkDocumentViewAccess ci-dessus a déjà échoué si elle n'est pas résolue.
  const wsOrgId = await getRequestOrgId(user);
  if (!wsOrgId) notFound();

  const [content, wsToken] = await Promise.all([
    (async () => {
      if (space && !doc.isFolder) {
        try {
          return await readDocument(space.gitRepoPath, doc.filePath);
        } catch {
          return doc.contentText || "";
        }
      }
      return "";
    })(),
    new SignJWT({
      id: user.id,
      name: user.name,
      email: user.email,
      globalRole: user.globalRole,
      orgId: wsOrgId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(wsSecret)),
  ]);

  const spaceClassification = (space?.classification || "internal") as "public" | "internal" | "confidential" | "secret";

  // Construire le fil d'Ariane : ancêtres (dossiers parents) du document
  const ancestors: { id: string; title: string; icon: string | null }[] = [];
  let currentParentId = doc.parentId;
  while (currentParentId) {
    const [parent] = await db
      .select({ id: documents.id, title: documents.title, icon: documents.icon, parentId: documents.parentId })
      .from(documents)
      .where(eq(documents.id, currentParentId))
      .limit(1);
    if (!parent) break;
    ancestors.unshift({ id: parent.id, title: parent.title, icon: parent.icon });
    currentParentId = parent.parentId;
  }

  const initialDoc = {
    id: doc.id,
    title: doc.title,
    slug: doc.slug,
    content,
    icon: doc.icon,
    visibility: doc.visibility as "private" | "team" | "public",
    classification: doc.classification as "public" | "internal" | "confidential" | "secret",
    spaceClassification,
    spaceId: doc.spaceId,
    createdBy: doc.createdBy,
    updatedAt: doc.updatedAt.toISOString(),
    backlinks: backlinkRows.map((b) => ({
      ...b,
      linkText: b.linkText ?? "",
    })),
    // Préférences d'affichage par document (densité, suivi de fin). Sans cette
    // ligne elles étaient écrites en base mais jamais relues au chargement.
    properties: (doc.properties ?? null) as { editorPaddingY?: string; followEnd?: boolean } | null,
  };

  const breadcrumbData = {
    space: {
      name: space?.name || spaceSlug,
      icon: space?.icon || null,
      slug: spaceSlug,
    },
    ancestors,
  };

  return (
    <DocumentPageClient
      initialDoc={initialDoc}
      initialWsToken={collabEnabled ? wsToken : ""}
      spaceSlug={spaceSlug}
      breadcrumb={breadcrumbData}
    />
  );
}

import { db } from "@/lib/db";
import { documentCollabStates } from "@/lib/db/schema";
import { templateContentToYjsState } from "@/lib/editor/template-to-yjs";
import logger from "@/lib/logger";

const log = logger.child({ module: "collab-seed" });

/**
 * Persist an initial Yjs state derived from markdown so the collaborative
 * editor opens the document with its content. Without it, the Hocuspocus
 * `fetch` hook returns an empty document and the markdown sync loop later
 * overwrites the file. No-op if a state already exists.
 */
export async function seedCollabState(
  documentId: string,
  markdown: string
): Promise<void> {
  const state = templateContentToYjsState({ markdown });
  if (!state) {
    log.warn({ documentId }, "Empty Yjs state, nothing seeded");
    return;
  }
  await db
    .insert(documentCollabStates)
    .values({
      documentId,
      yjsState: Buffer.from(state).toString("base64"),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
}

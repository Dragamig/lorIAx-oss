/**
 * Non-régression INJ-12 (audit du 2026-08-19, relevé pendant le lot 6).
 *
 * Les actions `create_document` et `create_design` acceptaient un `spaceId`
 * venu de la CONFIGURATION de l'action sans jamais confronter cet espace à
 * l'organisation de l'automatisation : connaître l'UUID d'un espace d'un autre
 * tenant suffisait à y écrire.
 *
 * Motif de vérification : « refuse ET n'écrit rien » : le refus doit tomber
 * avant toute création de document ou tout rendu/upload de design.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { spaces, userDatabases } from "@/lib/db/schema";

interface SpaceRow {
  id: string;
  organizationId: string;
}
interface DatabaseRow {
  id: string;
  spaceId: string;
}

let spaceRows: SpaceRow[] = [];
let databaseRows: DatabaseRow[] = [];
let permissions: Record<string, string | null> = {};
/** Identifiant demandé par le dernier `where` observé, pour filtrer les lignes. */
let lastRequestedId: string | null = null;

// Simulation minimale du constructeur de requêtes Drizzle : la table décide de
// la source de lignes, le `where` du filtre par identifiant. Une condition
// `eq(col, valeur)` porte sa valeur dans un paramètre imbriqué : on la relit en
// parcourant l'objet (structure circulaire, d'où l'ensemble des objets vus).
function extractId(condition: unknown): string | null {
  const seen = new Set<unknown>();
  const values: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (typeof record.value === "string") values.push(record.value);
    for (const child of Object.values(record)) walk(child);
  };
  walk(condition);
  return values[0] ?? null;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      let table: unknown = null;
      const builder = {
        from: vi.fn((t: unknown) => {
          table = t;
          return builder;
        }),
        where: vi.fn((cond: unknown) => {
          lastRequestedId = extractId(cond);
          return builder;
        }),
        limit: vi.fn(() => {
          if (table === spaces) {
            return Promise.resolve(
              spaceRows.filter((r) => r.id === lastRequestedId)
            );
          }
          if (table === userDatabases) {
            return Promise.resolve(
              databaseRows.filter((r) => r.id === lastRequestedId)
            );
          }
          return Promise.resolve([]);
        }),
      };
      return builder;
    }),
  },
}));

vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: vi.fn((userId: string, spaceId: string) =>
    Promise.resolve(permissions[`${userId}:${spaceId}`] ?? null)
  ),
}));

// Dépendances lourdes de `create_design` (rendu natif canvas, S3, BDD design).
vi.mock("@/lib/studio/instantiate-design-template", () => ({
  instantiateDesignTemplate: vi.fn(),
}));
vi.mock("@/lib/studio/render-design", () => ({
  renderDesign: vi.fn(),
}));
vi.mock("@/lib/storage/s3", () => ({
  uploadFile: vi.fn(),
}));
// Dépendance lourde de `create_document`.
vi.mock("@/lib/documents/create-document", () => ({
  createDocument: vi.fn(),
}));

import {
  resolveTargetSpaceId,
  AutomationTargetSpaceError,
} from "../../target-space";
import { createDesignAction } from "../create-design";
import { createDocumentAction } from "../create-document";
import { instantiateDesignTemplate } from "@/lib/studio/instantiate-design-template";
import { renderDesign } from "@/lib/studio/render-design";
import { uploadFile } from "@/lib/storage/s3";
import { createDocument } from "@/lib/documents/create-document";
import type { AutomationRow, ExecutionContext } from "../types";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SPACE_AUTO = "11111111-1111-4111-8111-111111111111";
const SPACE_SAME_ORG = "22222222-2222-4222-8222-222222222222";
const SPACE_OTHER_ORG = "33333333-3333-4333-8333-333333333333";
const SPACE_UNKNOWN = "99999999-9999-4999-8999-999999999999";
const DB_ID = "44444444-4444-4444-8444-444444444444";
const SPACE_OF_DB = "55555555-5555-4555-8555-555555555555";
const CREATOR = "66666666-6666-4666-8666-666666666666";
const TRIGGERER = "77777777-7777-4777-8777-777777777777";

const automation: AutomationRow = {
  id: "auto-1",
  databaseId: null,
  spaceId: SPACE_AUTO,
  name: "Test",
  triggerType: "manual",
  triggerConfig: null,
  actionType: "create_document",
  actionConfig: null,
  enabled: true,
  lastRunAt: null,
  createdBy: CREATOR,
};

const mockedInstantiate = vi.mocked(instantiateDesignTemplate);
const mockedRender = vi.mocked(renderDesign);
const mockedUpload = vi.mocked(uploadFile);
const mockedCreateDocument = vi.mocked(createDocument);

beforeEach(() => {
  vi.clearAllMocks();
  lastRequestedId = null;
  spaceRows = [
    { id: SPACE_AUTO, organizationId: ORG_A },
    { id: SPACE_SAME_ORG, organizationId: ORG_A },
    { id: SPACE_OTHER_ORG, organizationId: ORG_B },
    { id: SPACE_OF_DB, organizationId: ORG_A },
  ];
  databaseRows = [{ id: DB_ID, spaceId: SPACE_OF_DB }];
  permissions = {};

  mockedInstantiate.mockResolvedValue({
    name: "Affiche",
    design: { pages: [] } as never,
  });
  mockedRender.mockResolvedValue({
    buffer: Buffer.from("PNGDATA"),
    contentType: "image/png",
    ext: "png",
  });
  mockedUpload.mockImplementation(async (key: string) => key);
  mockedCreateDocument.mockResolvedValue({
    id: "doc-1",
    title: "Titre",
  } as never);
});

const ctxManual: ExecutionContext = { event: "manual" };

describe("resolveTargetSpaceId", () => {
  it("accepte l'espace de l'automatisation elle-même, sans contrôle de permission", async () => {
    const spaceId = await resolveTargetSpaceId({
      actionType: "create_document",
      configSpaceId: SPACE_AUTO,
      automation,
      ctx: ctxManual,
    });
    expect(spaceId).toBe(SPACE_AUTO);
  });

  it("refuse un espace d'une autre organisation", async () => {
    await expect(
      resolveTargetSpaceId({
        actionType: "create_document",
        configSpaceId: SPACE_OTHER_ORG,
        automation,
        ctx: ctxManual,
      })
    ).rejects.toBeInstanceOf(AutomationTargetSpaceError);
  });

  it("refuse un espace inexistant avec le même message qu'un espace d'un autre tenant", async () => {
    const messages: string[] = [];
    for (const target of [SPACE_UNKNOWN, SPACE_OTHER_ORG]) {
      await resolveTargetSpaceId({
        actionType: "create_document",
        configSpaceId: target,
        automation,
        ctx: ctxManual,
      }).catch((err: Error) => messages.push(err.message));
    }
    expect(messages).toHaveLength(2);
    // Pas d'oracle d'existence : les deux refus sont indiscernables.
    expect(messages[0]).toBe(messages[1]);
  });

  it("refuse un autre espace de la même organisation quand l'acteur n'y est que lecteur", async () => {
    permissions[`${CREATOR}:${SPACE_SAME_ORG}`] = "viewer";
    await expect(
      resolveTargetSpaceId({
        actionType: "create_document",
        configSpaceId: SPACE_SAME_ORG,
        automation,
        ctx: ctxManual,
      })
    ).rejects.toThrow(/droit d'écriture/);
  });

  it("accepte un autre espace de la même organisation quand l'acteur y est éditeur", async () => {
    permissions[`${CREATOR}:${SPACE_SAME_ORG}`] = "editor";
    const spaceId = await resolveTargetSpaceId({
      actionType: "create_document",
      configSpaceId: SPACE_SAME_ORG,
      automation,
      ctx: ctxManual,
    });
    expect(spaceId).toBe(SPACE_SAME_ORG);
  });

  it("préfère l'utilisateur déclencheur au créateur pour le contrôle d'écriture", async () => {
    permissions[`${CREATOR}:${SPACE_SAME_ORG}`] = "admin";
    permissions[`${TRIGGERER}:${SPACE_SAME_ORG}`] = "viewer";
    await expect(
      resolveTargetSpaceId({
        actionType: "create_document",
        configSpaceId: SPACE_SAME_ORG,
        automation,
        ctx: { event: "manual", user: { id: TRIGGERER } },
      })
    ).rejects.toThrow(/droit d'écriture/);
  });

  it("refuse sans acteur identifiable", async () => {
    const anonymous: AutomationRow = { ...automation, createdBy: null };
    await expect(
      resolveTargetSpaceId({
        actionType: "create_document",
        configSpaceId: SPACE_SAME_ORG,
        automation: anonymous,
        ctx: ctxManual,
      })
    ).rejects.toThrow(/acteur/);
  });

  it("remonte l'ancre par la base quand l'automatisation n'a pas de spaceId", async () => {
    const dbBound: AutomationRow = {
      ...automation,
      spaceId: null,
      databaseId: DB_ID,
    };
    // L'espace de la base est le périmètre propre : accepté sans permission.
    await expect(
      resolveTargetSpaceId({
        actionType: "create_document",
        configSpaceId: SPACE_OF_DB,
        automation: dbBound,
        ctx: ctxManual,
      })
    ).resolves.toBe(SPACE_OF_DB);
    // Et l'organisation de cette ancre borne bien les autres espaces.
    await expect(
      resolveTargetSpaceId({
        actionType: "create_document",
        configSpaceId: SPACE_OTHER_ORG,
        automation: dbBound,
        ctx: ctxManual,
      })
    ).rejects.toBeInstanceOf(AutomationTargetSpaceError);
  });

  it("refuse quand aucune ancre n'est déterminable (ni espace, ni base)", async () => {
    const orphan: AutomationRow = {
      ...automation,
      spaceId: null,
      databaseId: null,
    };
    await expect(
      resolveTargetSpaceId({
        actionType: "create_document",
        configSpaceId: SPACE_SAME_ORG,
        automation: orphan,
        ctx: ctxManual,
      })
    ).rejects.toThrow(/organisation de l'automatisation/);
  });

  it("rend undefined quand aucune source ne désigne d'espace", async () => {
    const orphan: AutomationRow = {
      ...automation,
      spaceId: null,
      databaseId: null,
    };
    await expect(
      resolveTargetSpaceId({
        actionType: "create_design",
        automation: orphan,
        ctx: ctxManual,
      })
    ).resolves.toBeUndefined();
  });

  it("valide aussi un spaceId venu du contexte d'exécution", async () => {
    await expect(
      resolveTargetSpaceId({
        actionType: "create_document",
        automation,
        ctx: { event: "manual", spaceId: SPACE_OTHER_ORG },
      })
    ).rejects.toBeInstanceOf(AutomationTargetSpaceError);
  });

  it("interpole le spaceId de config avant de le valider", async () => {
    permissions[`${CREATOR}:${SPACE_SAME_ORG}`] = "admin";
    await expect(
      resolveTargetSpaceId({
        actionType: "create_document",
        configSpaceId: "{{cells.sid}}",
        automation,
        ctx: { event: "manual", cells: { sid: SPACE_SAME_ORG } },
      })
    ).resolves.toBe(SPACE_SAME_ORG);
  });
});

describe("create_document : cloisonnement de l'espace cible", () => {
  it("refuse un espace d'une autre organisation sans créer de document", async () => {
    await expect(
      createDocumentAction.execute(
        { title: "Fuite", spaceId: SPACE_OTHER_ORG },
        automation,
        ctxManual
      )
    ).rejects.toBeInstanceOf(AutomationTargetSpaceError);
    expect(mockedCreateDocument).not.toHaveBeenCalled();
  });

  it("crée dans l'espace de l'automatisation quand la config n'impose rien", async () => {
    await createDocumentAction.execute({ title: "OK" }, automation, ctxManual);
    expect(mockedCreateDocument).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: SPACE_AUTO })
    );
  });
});

describe("create_design : cloisonnement de l'espace cible", () => {
  it("refuse un espace d'une autre organisation sans rendre ni téléverser", async () => {
    await expect(
      createDesignAction.execute(
        { templateId: "tpl-1", spaceId: SPACE_OTHER_ORG },
        automation,
        ctxManual
      )
    ).rejects.toBeInstanceOf(AutomationTargetSpaceError);
    expect(mockedInstantiate).not.toHaveBeenCalled();
    expect(mockedRender).not.toHaveBeenCalled();
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it("sans espace ni ancre : le gabarit est instancié, le versement échoue clairement", async () => {
    const orphan: AutomationRow = {
      ...automation,
      spaceId: null,
      databaseId: null,
    };
    await expect(
      createDesignAction.execute({ templateId: "tpl-global" }, orphan, {
        event: "manual",
      })
    ).rejects.toThrow(/organisation de l'automatisation indéterminable/);
    expect(mockedInstantiate).toHaveBeenCalledWith("tpl-global", {}, {
      spaceId: undefined,
    });
  });
});

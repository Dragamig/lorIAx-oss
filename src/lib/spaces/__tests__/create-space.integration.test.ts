import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { setupActivationFixture } from "@/lib/crm/__tests__/crm-fixture";
import { insertSpace } from "../create-space";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("insertSpace (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupActivationFixture>>;
  let orgId: string;
  const userId = randomUUID();

  beforeAll(async () => {
    fx = await setupActivationFixture(URL!, "rh_l6_act_space");
    // Colonnes de la table spaces que l'insertion Drizzle renseigne ou laisse par défaut.
    await fx.pool.query(`
      ALTER TABLE spaces ALTER COLUMN id SET DEFAULT gen_random_uuid();
      ALTER TABLE spaces
        ADD COLUMN slug varchar(255) NOT NULL DEFAULT '',
        ADD COLUMN type text NOT NULL DEFAULT 'personal',
        ADD COLUMN description text,
        ADD COLUMN owner_team_id uuid,
        ADD COLUMN git_repo_path varchar(512) NOT NULL DEFAULT '',
        ADD COLUMN classification text NOT NULL DEFAULT 'internal',
        ADD COLUMN icon varchar(50),
        ADD COLUMN appearance_preset jsonb,
        ADD COLUMN is_demo boolean NOT NULL DEFAULT false,
        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    `);
    await fx.pool.query("INSERT INTO users (id, name) VALUES ($1, 'Admin')", [userId]);
    orgId = await fx.seedOrg("Org Espace");
  });
  afterAll(async () => {
    await fx.teardown();
  });

  async function countSpaces(name: string) {
    const { rows } = await fx.pool.query("SELECT count(*)::int AS n FROM spaces WHERE name = $1", [name]);
    return rows[0].n as number;
  }

  it("insertSpace crée l'espace dans l'organisation fournie avec l'utilisateur propriétaire", async () => {
    const space = await insertSpace(fx.db, {
      orgId, userId, name: "Mon Espace Équipe", type: "organization", description: "d", icon: "star",
    });
    expect(space.organizationId).toBe(orgId);
    expect(space.ownerUserId).toBe(userId);
    expect(space.ownerTeamId).toBeNull();
    expect(space.slug).toBe("mon-espace-equipe");
    expect(space.gitRepoPath).toMatch(/^organization\/mon-espace-equipe-\d+$/);
    expect(space.description).toBe("d");
    expect(space.icon).toBe("star");
    const { rows } = await fx.pool.query("SELECT organization_id, owner_user_id FROM spaces WHERE id = $1", [space.id]);
    expect(rows[0].organization_id).toBe(orgId);
    expect(rows[0].owner_user_id).toBe(userId);
  });

  it("insertSpace dans une transaction annulée ne laisse aucun espace", async () => {
    await expect(
      fx.db.transaction(async (tx) => {
        await insertSpace(tx, { orgId, userId, name: "Annulé", type: "personal" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await countSpaces("Annulé")).toBe(0);
  });

  it("type team : propriétaire d'équipe, pas d'utilisateur", async () => {
    const teamId = randomUUID();
    const space = await insertSpace(fx.db, { orgId, userId, name: "Equipe", type: "team", ownerTeamId: teamId });
    expect(space.ownerUserId).toBeNull();
    expect(space.ownerTeamId).toBe(teamId);
    expect(space.gitRepoPath).toMatch(/^team\/equipe-\d+$/);
  });
});

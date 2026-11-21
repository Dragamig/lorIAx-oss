/**
 * Garde-fou : `PUT /api/admin/backups/config` ne doit jamais activer le module
 * `backup` (dont `backup_s3` est la toggleKey) ; seul
 * `PATCH /api/admin/modules/[id]` le peut, avec contrôle du rôle
 * (`manageRole: "super_admin"`), de la licence, de l'offre de l'organisation et
 * des dépendances.
 *
 * Approche : test unitaire ciblé, pas un test du route handler. Le dépôt n'a
 * aucun motif de test de route handler (cf.
 * src/app/api/admin/modules/[id]/route-entitlement.test.ts, même choix) : mocker
 * les internes Next.js, la session et la base serait fragile. On rejoue donc la
 * décision exacte que prend la route sur le corps reçu, avec les helpers qu'elle
 * importe.
 */
import { describe, it, expect } from "vitest";
import { mergeSettingValue } from "@/lib/settings/merge";
import { stripModuleToggleFields } from "@/lib/settings/module-toggles";
import { getModuleManifest } from "@/lib/modules/registry";
import { parseToggleValue, resolveToggleKey } from "@/lib/modules/toggle";

const backupManifest = getModuleManifest("backup")!;

/**
 * Décision de la route pour `body.s3` : ce qui finit (ou non) dans
 * `system_settings.backup_s3`. Le chiffrement du secret, non concerné ici, est
 * volontairement omis.
 */
function decideS3Write(existing: unknown, incoming: unknown): { written: unknown } | null {
  const stripped = stripModuleToggleFields("backup_s3", incoming);
  if (stripped.skip) return null;
  return { written: mergeSettingValue(existing ?? null, stripped.value) };
}

/** État de l'interrupteur tel que le relira `getModuleToggles`. */
function toggleState(value: unknown): boolean | null {
  return parseToggleValue(value, backupManifest.toggleField);
}

describe("PUT /api/admin/backups/config — l'interrupteur du module reste hors de portée", () => {
  it("le module backup stocke bien son interrupteur sous la clé écrite par cette route", () => {
    expect(resolveToggleKey(backupManifest)).toBe("backup_s3");
    expect(backupManifest.entitlement).toBe("licensed");
    expect(backupManifest.manageRole).toBe("super_admin");
  });

  it("un corps qui tente d'activer le module n'active rien, mais enregistre la config S3", () => {
    const existing = { enabled: false, s3BackupBucket: "ancien" };
    const result = decideS3Write(existing, {
      enabled: true,
      s3BackupBucket: "nouveau",
      s3BackupEndpoint: "https://s3.example.org",
    });

    expect(result).not.toBeNull();
    expect(result!.written).toEqual({
      enabled: false,
      s3BackupBucket: "nouveau",
      s3BackupEndpoint: "https://s3.example.org",
    });
    expect(toggleState(result!.written)).toBe(false);
  });

  it("un corps qui tente de désactiver le module ne l'éteint pas (onglet obsolète)", () => {
    const existing = { enabled: true, s3BackupBucket: "prod" };
    const result = decideS3Write(existing, { enabled: false, s3BackupBucket: "prod" });

    expect(toggleState(result!.written)).toBe(true);
  });

  it("un corps réduit au seul interrupteur n'écrit rien du tout", () => {
    expect(decideS3Write({ enabled: false }, { enabled: true })).toBeNull();
  });

  it("sans interrupteur en base, la route n'en crée pas un", () => {
    const result = decideS3Write(null, { enabled: true, s3BackupBucket: "nouveau" });
    expect(result!.written).toEqual({ s3BackupBucket: "nouveau" });
    expect(toggleState(result!.written)).toBeNull();
  });

  it("les champs absents du corps reçu survivent à l'enregistrement", () => {
    const existing = { enabled: true, s3BackupBucket: "prod", s3BackupSecretKey: "chiffre" };
    const result = decideS3Write(existing, { s3BackupBucket: "prod-2" });

    expect(result!.written).toEqual({
      enabled: true,
      s3BackupBucket: "prod-2",
      s3BackupSecretKey: "chiffre",
    });
  });
});

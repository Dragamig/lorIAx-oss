import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const SRC = path.resolve(__dirname, "../..");

/** Fichiers autorisés à supprimer un objet S3, hors tests, avec la raison. */
const ALLOWED: Record<string, string> = {
  "lib/storage/s3.ts": "définition de deleteFile",
  "lib/media/multipart.ts": "supprime l'objet assemblé d'un envoi multipart refusé à la finalisation (jamais référencé par une ligne media)",
  "lib/media/purge.ts": "seul point de suppression de la médiathèque (purge et effacement)",
  "app/api/user/avatar/route.ts": "hors médiathèque : suppression de l'avatar de l'utilisateur, objet propre à l'utilisateur",
  "app/api/meeting-rooms/[id]/upload/route.ts": "hors médiathèque : remplacement de l'image de salle, clé propre à la salle",  "app/api/presentations/[id]/route.ts": "hors médiathèque : révisions JSON et suppression d'une présentation, clés propres à la présentation (préfixe presentations/)",
  "lib/ai/creation/apply.ts": "hors médiathèque : annulation d'une création par le chat, révisions et clé de la présentation créée (préfixe presentations/)",
};

/** Toute suppression d'objet : fonction maison, commandes SDK, envoi direct d'une commande Delete*. */
const DELETE_RE =
  /\b(deleteFile|DeleteObjectCommand|DeleteObjectsCommand|DeleteObjects?|deleteObjects?)\b|\.send\([^)]*Delete/;
const SDK_IMPORT_RE = /@aws-sdk\/client-s3/;

/** Fichiers autorisés à importer le SDK S3 : lecture seule (Get/Head), la raison est consignée. */
const SDK_IMPORTERS: Record<string, string> = {
  "lib/storage/s3.ts": "client S3 de l'application et deleteFile",
  "lib/backup/s3-backup.ts": "sauvegarde : HeadBucket, aucune suppression",
  "lib/media/serve.ts": "lecture : Get et Head",
  "app/api/health/route.ts": "sonde HeadBucket",
  "app/api/admin/backups/download/route.ts": "lecture de sauvegarde",
  "app/api/admin/backups/restore/route.ts": "lecture de sauvegarde",
  "app/api/attachments/[...key]/route.ts": "lecture : GetObject",
  "app/api/designs/[id]/route.ts": "lecture : GetObject",
  "app/api/setup/upload/route.ts": "lecture : GetObject",
  "app/api/user/avatar/route.ts": "lecture : GetObject",
  "app/api/meeting-rooms/[id]/upload/route.ts": "lecture : GetObject",
};

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("garde-fou : suppression d'objet S3", () => {
  it("deleteFile et DeleteObjectCommand ne sont référencés que par la liste blanche", () => {
    const offenders = walk(SRC)
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
      .filter((rel) => !rel.startsWith("tests/") && !rel.startsWith("__tests__/"))
      .filter((rel) => DELETE_RE.test(stripComments(readFileSync(path.join(SRC, rel), "utf8"))))
      .filter((rel) => !(rel in ALLOWED));
    expect(offenders).toEqual([]);
  });

  it("chaque entrée de la liste blanche existe encore et en a besoin", () => {
    for (const rel of Object.keys(ALLOWED)) {
      const src = readFileSync(path.join(SRC, rel), "utf8");
      expect(DELETE_RE.test(stripComments(src)), rel).toBe(true);
    }
  });

  it("tout fichier important le SDK S3 figure dans la liste blanche commentée", () => {
    const offenders = walk(SRC)
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
      .filter((rel) => !rel.startsWith("tests/") && !rel.startsWith("__tests__/"))
      .filter((rel) => SDK_IMPORT_RE.test(readFileSync(path.join(SRC, rel), "utf8")))
      .filter((rel) => !(rel in SDK_IMPORTERS) && !(rel in ALLOWED));
    expect(offenders).toEqual([]);
  });

  it("les importateurs listés existent encore et importent le SDK", () => {
    for (const rel of Object.keys(SDK_IMPORTERS)) {
      expect(SDK_IMPORT_RE.test(readFileSync(path.join(SRC, rel), "utf8")), rel).toBe(true);
    }
  });

  it("le motif détecte DeleteObjects, deleteObjects et un envoi de commande Delete", () => {
    for (const code of [
      "new DeleteObjectsCommand({})",
      "client.deleteObjects(x)",
      "await s3.send(new DeleteBucketCommand({}))",
      "DeleteObject",
    ]) {
      expect(DELETE_RE.test(code), code).toBe(true);
    }
    expect(DELETE_RE.test("new GetObjectCommand({})")).toBe(false);
  });
});

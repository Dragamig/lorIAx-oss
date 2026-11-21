import { describe, it, expect } from "vitest";
import { filterRestoreToc } from "./restore-toc";

const TOC = `;
; Archive created at 2026-11-10
221; 1259 16400 TABLE public attachments loriax
222; 1259 16410 TABLE public media loriax
3401; 0 16400 TABLE DATA public attachments loriax
3402; 0 16410 TABLE DATA public media loriax
3501; 2606 16420 CONSTRAINT public attachments attachments_pkey loriax
3601; 1259 16430 INDEX public idx_attachments_document loriax
3602; 1259 16431 INDEX public idx_attachments_storage_key loriax
3603; 1259 16432 INDEX public idx_media_org loriax
3701; 2606 16440 FK CONSTRAINT public attachments attachments_document_id_fkey loriax
3702; 2606 16441 FK CONSTRAINT public media media_document_id_fkey loriax`;

describe("restauration : table héritée attachments", () => {
  const { list, ignored } = filterRestoreToc(TOC);

  it("écarte structure, données, index et contraintes d'attachments", () => {
    expect(ignored).toHaveLength(6);
    for (const l of ignored) expect(l).toContain("attachments");
  });

  it("ne touche à aucune entrée media", () => {
    const active = list.split("\n").filter((l) => /^\d/.test(l));
    expect(active).toHaveLength(4);
    expect(active.join("\n")).toContain("TABLE DATA public media");
    expect(active.join("\n")).toContain("idx_media_org");
    expect(active.join("\n")).not.toContain("attachments");
  });

  it("ne touche pas aux tables archivées du schéma legacy_archive", () => {
    const toc = "221; 1259 16400 TABLE legacy_archive attachments loriax\n3401; 0 16400 TABLE DATA legacy_archive attachments loriax\n";
    const r = filterRestoreToc(toc);
    expect(r.ignored).toHaveLength(0);
    expect(r.list).toBe(toc);
  });

  it("commente les lignes écartées au lieu de les supprimer", () => {
    expect(list).toContain(";221; 1259 16400 TABLE public attachments loriax");
  });

  it("une sauvegarde sans attachments reste identique", () => {
    const t = "1; 1259 1 TABLE public media loriax";
    expect(filterRestoreToc(t)).toEqual({ list: t, ignored: [] });
  });
});

const FULL_TOC = `;
10; 1255 16001 FUNCTION public media_sync_from_attachments() loriax
11; 1255 16002 FUNCTION public media_sync_from_studio_images() loriax
12; 1255 16003 FUNCTION public media_other_helper() loriax
20; 1259 16010 TABLE public studio_images loriax
21; 1259 16011 TABLE public media_usages loriax
22; 1259 16012 TABLE public media_attachments_log loriax
23; 1259 16013 SEQUENCE public studio_images_id_seq loriax
24; 1259 16014 TABLE public media loriax
30; 0 16010 TABLE DATA public studio_images loriax
31; 0 16014 TABLE DATA public media loriax
32; 0 16011 TABLE DATA public media_usages loriax
40; 1259 16020 INDEX public idx_studio_images_created_by loriax
41; 1259 16021 INDEX public idx_media_usages_media loriax
50; 2606 16030 CONSTRAINT public studio_images studio_images_pkey loriax
51; 2606 16031 FK CONSTRAINT public studio_images studio_images_created_by_fkey loriax
52; 2606 16032 FK CONSTRAINT public media_usages media_usages_media_id_fkey loriax
60; 2620 16040 TRIGGER public attachments trg_attachments_to_media loriax
61; 2620 16041 TRIGGER public studio_images trg_studio_images_to_media loriax
62; 2620 16042 TRIGGER public media trg_media_touch loriax
70; 0 0 COMMENT public TABLE attachments loriax
71; 0 0 COMMENT public COLUMN studio_images.url loriax
72; 0 0 COMMENT public TABLE media loriax
73; 0 0 COMMENT public FUNCTION media_sync_from_attachments() loriax
74; 0 0 COMMENT public COLUMN media.name loriax
75; 0 0 COMMENT public INDEX idx_studio_images_created_by loriax
80; 0 0 ACL public TABLE studio_images loriax
81; 0 0 ACL public TABLE media loriax
82; 0 0 ACL public SEQUENCE studio_images_id_seq loriax
83; 0 0 DEFAULT public studio_images id loriax`;

describe("restauration : sauvegarde complète 1.204.x", () => {
  const { list, ignored } = filterRestoreToc(FULL_TOC);
  const active = list.split("\n").filter((l) => /^\d/.test(l));

  it("écarte studio_images, déclencheurs, fonctions, COMMENT, ACL, séquences, index et clés", () => {
    for (const id of [10, 11, 20, 23, 30, 40, 50, 51, 60, 61, 70, 71, 73, 75, 80, 82, 83]) {
      expect(ignored.some((l) => l.startsWith(`${id};`)), `entrée ${id}`).toBe(true);
    }
    expect(ignored).toHaveLength(17);
  });

  it("ne touche ni media, ni media_usages, ni une table au nom proche", () => {
    for (const id of [12, 21, 22, 24, 31, 32, 41, 52, 62, 72, 74, 81]) {
      expect(active.some((l) => l.startsWith(`${id};`)), `entrée ${id}`).toBe(true);
    }
    expect(active).toHaveLength(12);
  });
});

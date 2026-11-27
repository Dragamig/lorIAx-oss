import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  findExcludedLeftovers,
  OPTIONAL_EXTENSIONS_FILE,
  REGISTRY_FILE,
  SLASH_COMMANDS_FILE,
  StripError,
  deleteMessageKeys,
  stripOptionalExtensions,
  stripRegistryManifests,
  stripSlashCommands,
} from "./strip-excluded-modules";

describe("strip-excluded-modules", () => {
  it("strips_registry_manifests_by_id_and_keeps_the_others", () => {
    const src = [
      "const MANIFESTS = [",
      "  {",
      '    id: "a",',
      "    ownedPaths: [],",
      "  },",
      "  {",
      '    id: "b",',
      '    ownedPaths: ["x"],',
      "  },",
      "];",
    ].join("\n");
    const out = stripRegistryManifests(src, ["b"]);
    expect(out).toContain('id: "a"');
    expect(out).not.toContain('id: "b"');
    expect(out).not.toContain('"x"');
    expect(out.endsWith("];")).toBe(true);
  });

  it("strips_slash_commands_gated_by_an_excluded_module_with_their_aliases", () => {
    const src = [
      "import {",
      "  Clapperboard,",
      "  Other,",
      "} from \"x\";",
      "const ALIASES = {",
      '  "Montage": ["a"],',
      '  "Keep": ["b"],',
      "};",
      "const COMMANDS = [",
      "  {",
      '    title: "Montage",',
      '    module: "vid",',
      "    icon: <Clapperboard />,",
      "  },",
      "  {",
      '    title: "Keep",',
      "  },",
      "];",
    ].join("\n");
    const out = stripSlashCommands(src, ["vid"]);
    expect(out).not.toContain("Montage");
    expect(out).not.toContain("Clapperboard");
    expect(out).toContain('title: "Keep"');
    expect(out).toContain('"Keep": ["b"]');
  });

  it("strips_optional_extensions_of_excluded_modules", () => {
    const src = '  { key: "A", moduleId: "vid" },\n  { key: "B", moduleId: "ok" },';
    expect(stripOptionalExtensions(src, ["vid"])).toBe('  { key: "B", moduleId: "ok" },');
  });

  it("deletes_dotted_message_keys_only_when_present", () => {
    const m = { auth: { signup: { a: 1 }, register: { createOrg: "x", keep: "y" } } };
    expect(deleteMessageKeys(m, ["auth.signup", "auth.register.createOrg", "nope.deep"])).toBe(true);
    expect(m).toEqual({ auth: { register: { keep: "y" } } });
    expect(deleteMessageKeys(m, ["auth.signup"])).toBe(false);
  });

  it("fails_when_a_manifest_pattern_is_not_found", () => {
    const src = ["const M = [", "  {", '    id: "a",', "  },", "];"].join("\n");
    expect(() => stripRegistryManifests(src, ["ghost"])).toThrow(StripError);
    expect(() => stripRegistryManifests(src, ["ghost"])).toThrow(/ghost/);
  });

  it("fails_when_a_manifest_block_is_not_closed", () => {
    const src = ["const M = [", "  {", '    id: "b",', "    nested: {", "      x: 1,", "    },"].join("\n");
    expect(() => stripRegistryManifests(src, ["b"])).toThrow(/non refermé/);
  });

  it("strips_a_manifest_block_with_nested_objects_entirely", () => {
    const src = [
      "const M = [",
      "  {",
      '    id: "b",',
      "    nested: {",
      "      deep: [{ a: 1 }],",
      "    },",
      "    tail: 1,",
      "  },",
      "  {",
      '    id: "a",',
      "  },",
      "];",
    ].join("\n");
    const out = stripRegistryManifests(src, ["b"]);
    expect(out).not.toMatch(/nested|tail|deep/);
    expect(out).toContain('id: "a"');
  });

  it("fails_when_an_expected_slash_or_optional_entry_is_missing", () => {
    expect(() => stripSlashCommands('  {\n    title: "Keep",\n  },', ["studiovideo"])).toThrow(/studiovideo/);
    expect(() => stripOptionalExtensions('  { key: "B", moduleId: "ok" },', ["studiovideo"])).toThrow(/studiovideo/);
  });

  it("fails_when_a_slash_command_block_is_not_closed", () => {
    const src = ["  {", '    title: "Montage",', '    module: "studiovideo",', "    icon: 1,"].join("\n");
    expect(() => stripSlashCommands(src, ["studiovideo"])).toThrow(/non refermée/);
  });

  describe("findExcludedLeftovers", () => {
    const write = (root: string, rel: string, body: string) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), body);
    };
    const tree = (registry: string, slash: string, optional: string, messages: unknown) => {
      const root = mkdtempSync(join(tmpdir(), "strip-left-"));
      write(root, REGISTRY_FILE, registry);
      write(root, SLASH_COMMANDS_FILE, slash);
      write(root, OPTIONAL_EXTENSIONS_FILE, optional);
      write(root, "messages/fr.json", JSON.stringify(messages));
      return root;
    };

    it("returns_nothing_on_a_clean_tree", () => {
      const root = tree('  {\n    id: "a",\n  },', '    module: "a",', '{ moduleId: "a" }', { k: 1 });
      try {
        expect(findExcludedLeftovers(root, ["commercial"], ["auth.signup"])).toEqual([]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("reports_every_leftover_in_registry_slash_optional_and_messages", () => {
      const root = tree(
        '  {\n    id: "commercial",\n  },',
        '    module: "studiovideo",',
        '{ moduleId: "studiovideo" }',
        { auth: { signup: 1 } },
      );
      try {
        const out = findExcludedLeftovers(root, ["commercial", "studiovideo"], ["auth.signup"]);
        expect(out).toHaveLength(4);
        expect(out.join("\n")).toMatch(/auth\.signup/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});

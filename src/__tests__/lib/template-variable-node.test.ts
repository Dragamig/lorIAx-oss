import { describe, it, expect } from "vitest";
import { TemplateVariable } from "@/components/editor/extensions/template-variable";
import { extractTemplateVariables } from "@/lib/automations/template-variables";

describe("nœud templateVariable", () => {
  it("expose le nom, inline et atomique", () => {
    expect(TemplateVariable.name).toBe("templateVariable");
    expect(TemplateVariable.config.group).toBe("inline");
    expect(TemplateVariable.config.inline).toBe(true);
    expect(TemplateVariable.config.atom).toBe(true);
  });

  it("sérialise en {{key}} dans le storage markdown", () => {
    const storage = TemplateVariable.config.addStorage?.call({} as never);
    const chunks: string[] = [];
    storage!.markdown.serialize(
      { write: (s: string) => chunks.push(s) },
      { attrs: { key: "prenom", label: "Prénom" } }
    );
    expect(chunks.join("")).toBe("{{prenom}}");
  });

  it("est extrait par extractTemplateVariables (contrat Task 10)", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Bonjour " },
            { type: "templateVariable", attrs: { key: "prenom", label: "Prénom" } },
          ],
        },
      ],
    };
    expect(extractTemplateVariables(content)).toEqual([{ key: "prenom", label: "Prénom" }]);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ActivationRecap } from "./activation-recap";
import type { ActivationState } from "./activation-state";
import type { ActivationPreview } from "@/lib/crm/preview";

vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock());

const empty = { candidates: [], preselected: null };
const preview = {
  roles: { contacts: empty, dossiers: empty, interactions: empty },
  existing: false,
  spaces: [],
  suggestedSpaceId: null,
  collisions: { contacts: [], dossiers: [], interactions: [] },
  orgs: [],
} as unknown as ActivationPreview;
const state: ActivationState = {
  orgSlug: "lor",
  spaceId: "create",
  roles: {
    contacts: { mode: "create", databaseId: null },
    dossiers: { mode: "create", databaseId: null },
    interactions: { mode: "create", databaseId: null },
  },
};

afterEach(cleanup);

describe("ActivationRecap : paires de relations", () => {
  it("place une flèche d'échange décorative entre les deux lignes de chaque paire", () => {
    render(<ActivationRecap state={state} preview={preview} orgName="Org" spaceName="CRM" />);
    const pairs = screen.getAllByTestId("recap-relation-pair");
    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) {
      const [first, swap, second] = Array.from(pair.children);
      expect(swap).toBe(within(pair).getByTestId("recap-relation-swap"));
      expect(swap.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(first.textContent).toBeTruthy();
      expect(second.textContent).toBeTruthy();
      expect(pair.children).toHaveLength(3);
    }
  });
});

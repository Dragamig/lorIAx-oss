// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({ messages: [], sendMessage: vi.fn(), status: "ready" }),
}));
vi.mock("swr", () => ({
  default: () => ({ data: { enabled: true, aiConfigured: true } }),
}));
vi.mock("@/lib/modules/hooks.client.generated", () => ({ registerIncludedModuleHooks: () => {} }));

import { resetClientSlotsForTests } from "@/lib/modules/hooks.client";
import { HelpAssistant } from "./help-assistant";

beforeEach(() => resetClientSlotsForTests());
afterEach(cleanup);
Element.prototype.scrollIntoView = vi.fn();

describe("assistant d'aide noyau", () => {
  it("neutral_help_has_no_bug_chip_nor_bug_placeholder", async () => {
    render(<HelpAssistant />);
    screen.getAllByRole("button")[0].click();
    expect(await screen.findByText("Posez une question sur LorIAx.")).toBeTruthy();
    expect(screen.queryByText("Signaler un bug")).toBeNull();
    expect(screen.getByText("Comment partager un document ?")).toBeTruthy();
  });
});

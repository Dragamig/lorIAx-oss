import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/modules/hooks.client.generated", () => ({ registerIncludedModuleHooks: () => {} }));

import { getSettingsTabs } from "./settings-tabs";
import { registerClientSlots, resetClientSlotsForTests } from "@/lib/modules/hooks.client";

beforeEach(() => resetClientSlotsForTests());

describe("getSettingsTabs", () => {
  it("settings_hides_subscription_tab_without_slot", () => {
    expect(getSettingsTabs().map((t) => t.id)).toEqual(["general", "api-keys", "webhooks", "mailbox"]);
  });

  it("settings_shows_subscription_tab_with_slot", () => {
    registerClientSlots({ SubscriptionTab: () => null });
    expect(getSettingsTabs().map((t) => t.id)).toEqual(["general", "api-keys", "webhooks", "subscription", "mailbox"]);
  });
});

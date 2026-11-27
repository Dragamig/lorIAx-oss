// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "../../../../messages/fr.json";
import { crmActivityKey } from "@/lib/crm/activity-actions";
import { DealActivity } from "./deal-activity";
import { makeDealSheetDto } from "./deal-sheet-fixture";

const swr = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("swr", async (orig) => ({ ...(await orig<typeof import("swr")>()), useSWRConfig: () => ({ mutate: swr.mutate }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("./activity/activity-feed", () => ({
  ActivityFeed: ({ header, children }: { header?: React.ReactNode; children?: React.ReactNode }) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));

let postOk: boolean;
beforeEach(() => {
  postOk = true;
  swr.mutate.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => (postOk ? { ok: true, status: 201, json: async () => ({}) } : { ok: false, status: 500, json: async () => ({}) })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function submit() {
  const dto = makeDealSheetDto();
  const onCreated = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <DealActivity dto={dto} onCreated={onCreated} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Ajouter une interaction au dossier/ }));
  fireEvent.change(screen.getByLabelText("Type d'interaction"), { target: { value: "Appel" } });
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
  return { dto, onCreated };
}

describe("revalidation du fil après création d'une interaction", () => {
  it("succès : mutate appelé avec la clé du fil", async () => {
    const { dto, onCreated } = submit();
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(swr.mutate).toHaveBeenCalledWith(crmActivityKey(dto.databaseId, dto.deal.id));
  });

  it("échec : mutate non appelé", async () => {
    postOk = false;
    const { onCreated } = submit();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(swr.mutate).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

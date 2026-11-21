// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function setup() {
  render(
    <Tabs defaultValue="a">
      <TabsList aria-label="Fiche">
        <TabsTrigger value="a">Un</TabsTrigger>
        <TabsTrigger value="b">Deux</TabsTrigger>
        <TabsTrigger value="c">Trois</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Panneau A</TabsContent>
      <TabsContent value="b">Panneau B</TabsContent>
      <TabsContent value="c">Panneau C</TabsContent>
    </Tabs>,
  );
  return screen.getAllByRole("tab");
}

afterEach(cleanup);

describe("Tabs", () => {
  it("flèche droite déplace la sélection et le focus, Origine et Fin", async () => {
    const tabs = setup();
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(tabs[1]));
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[1], { key: "End" });
    await waitFor(() => expect(document.activeElement).toBe(tabs[2]));
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[2], { key: "Home" });
    await waitFor(() => expect(document.activeElement).toBe(tabs[0]));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  it("aria-selected, aria-controls et tabindex itinérant", () => {
    const tabs = setup();
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
    const panel = screen.getByRole("tabpanel");
    expect(tabs[0].getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.textContent).toBe("Panneau A");
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[1].tabIndex).toBe(-1);
  });
});

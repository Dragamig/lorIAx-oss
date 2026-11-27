// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DEAL_MIME, usePipelineDrag } from "./use-pipeline-drag";

function dt(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    types: Object.keys(store),
    setData(type: string, v: string) {
      store[type] = v;
      this.types = Object.keys(store);
    },
    getData: (type: string) => store[type] ?? "",
    effectAllowed: "",
    dropEffect: "",
  };
}

function Harness({ onMove, disabled = false }: { onMove: (id: string, lane: string) => Promise<boolean>; disabled?: boolean }) {
  const drag = usePipelineDrag({ onMove, disabled });
  return (
    <div>
      <div data-testid="card" {...drag.cardProps("d1", "A")} />
      <div data-testid="laneA" {...drag.laneProps("A")} />
      <div data-testid="laneB" {...drag.laneProps("B")} />
      <output data-testid="state">{`${drag.draggingId ?? ""}|${drag.overLane ?? ""}|${drag.result ? `${drag.result.dealId}:${drag.result.laneKey}:${drag.result.ok}` : ""}`}</output>
    </div>
  );
}

async function dropOn(lane: string, from = "A") {
  const data = dt();
  fireEvent.dragStart(screen.getByTestId("card"), { dataTransfer: data });
  const payload = JSON.stringify({ id: "d1", from });
  data.setData(DEAL_MIME, payload);
  fireEvent.dragOver(screen.getByTestId(lane), { dataTransfer: data });
  await act(async () => {
    fireEvent.drop(screen.getByTestId(lane), { dataTransfer: data });
  });
}

describe("usePipelineDrag", () => {
  it("un dépôt sur une autre voie appelle onMove une fois", async () => {
    const onMove = vi.fn(async () => true);
    render(<Harness onMove={onMove} />);
    await dropOn("laneB");
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith("d1", "B");
    expect(screen.getByTestId("state").textContent).toBe("||d1:B:true");
  });
  it("dépôt sur la voie d'origine : aucun appel", async () => {
    const onMove = vi.fn(async () => true);
    render(<Harness onMove={onMove} />);
    await dropOn("laneA");
    expect(onMove).not.toHaveBeenCalled();
  });
  it("désactivé : carte non glissable et aucun appel", async () => {
    const onMove = vi.fn(async () => true);
    render(<Harness onMove={onMove} disabled />);
    expect(screen.getByTestId("card").getAttribute("draggable")).toBe("false");
    await dropOn("laneB");
    expect(onMove).not.toHaveBeenCalled();
  });
  it("onMove rendant false : résultat en échec", async () => {
    const onMove = vi.fn(async () => false);
    render(<Harness onMove={onMove} />);
    await dropOn("laneB");
    expect(screen.getByTestId("state").textContent).toBe("||d1:B:false");
  });
  it("un dépôt d'un autre type (kanban Bases) est ignoré", async () => {
    const onMove = vi.fn(async () => true);
    render(<Harness onMove={onMove} />);
    const other = dt({ "application/x-kanban-card": JSON.stringify({ rowId: "x", from: "A" }) });
    fireEvent.dragOver(screen.getByTestId("laneB"), { dataTransfer: other });
    await act(async () => {
      fireEvent.drop(screen.getByTestId("laneB"), { dataTransfer: other });
    });
    expect(onMove).not.toHaveBeenCalled();
  });
  it("survol : voie cible signalée, puis effacée à la sortie", () => {
    render(<Harness onMove={async () => true} />);
    const data = dt();
    fireEvent.dragStart(screen.getByTestId("card"), { dataTransfer: data });
    expect(screen.getByTestId("state").textContent).toBe("d1||");
    fireEvent.dragOver(screen.getByTestId("laneB"), { dataTransfer: data });
    expect(screen.getByTestId("state").textContent).toBe("d1|B|");
    fireEvent.dragLeave(screen.getByTestId("laneB"), { dataTransfer: data });
    expect(screen.getByTestId("state").textContent).toBe("d1||");
    fireEvent.dragEnd(screen.getByTestId("card"), { dataTransfer: data });
    expect(screen.getByTestId("state").textContent).toBe("||");
  });
});

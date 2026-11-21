/**
 * Cloisonnement par organisation du serveur WebSocket de chat : un canal d'une
 * autre organisation que celle du jeton est refusé, sans oracle d'existence.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ memberRow: [] as unknown[], orgFilter: null as unknown }));

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => self),
    from: vi.fn(() => self),
    innerJoin: vi.fn(() => self),
    where: vi.fn(() => self),
    limit: vi.fn(() => Promise.resolve(state.memberRow)),
    then: (resolve: (v: unknown[]) => void) => resolve([]),
    insert: vi.fn(() => self),
    values: vi.fn(() => self),
    returning: vi.fn(() =>
      Promise.resolve([{ id: "m1", channelId: "c1", content: "salut", createdAt: new Date() }])
    ),
  };
  return { db: self };
});

const verifyWsToken = vi.hoisted(() => vi.fn());
vi.mock("@/lib/collab/auth-ws", () => ({ verifyWsToken }));
vi.mock("@/lib/chat/chat-notifications", () => ({
  notifyChannelMembers: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// Les colonnes sont comparées par valeur d'égalité : on capture les filtres org
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: vi.fn(actual.eq), and: vi.fn(actual.and) };
});

import { ChatServer } from "@/lib/chat/chat-server";
import { chatChannels } from "@/lib/db/schema-chat";
import { eq } from "drizzle-orm";

type Handler = (raw: Buffer) => Promise<void>;

function fakeWs() {
  const handlers: Record<string, Handler> = {};
  const ws = {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn((evt: string, h: Handler) => {
      handlers[evt] = h;
    }),
  };
  const emit = (msg: unknown) => handlers.message(Buffer.from(JSON.stringify(msg)));
  return { ws, emit };
}

async function connect(orgId: string | null) {
  verifyWsToken.mockResolvedValue({ id: "u1", name: "U", orgId });
  const server = new ChatServer();
  const { ws, emit } = fakeWs();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.handleConnection(ws as any);
  await emit({ type: "auth", token: "t" });
  return { ws, emit };
}

const sent = (ws: { send: ReturnType<typeof vi.fn> }) =>
  ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));

beforeEach(() => {
  state.memberRow = [];
  vi.mocked(eq).mockClear();
});

describe("ChatServer : cloisonnement par organisation", () => {
  it("refuse un jeton sans organisation", async () => {
    const { ws } = await connect(null);
    expect(ws.close).toHaveBeenCalledWith(4003, "Unauthorized");
  });

  it("refuse un message sur un canal hors de l'organisation du jeton", async () => {
    const { ws, emit } = await connect("org-a");
    // La jointure org ne renvoie aucune ligne pour un canal d'une autre org
    state.memberRow = [];
    await emit({ type: "message", channelId: "c-org-b", content: "salut" });
    expect(sent(ws).some((m) => m.type === "error" && m.code === 403)).toBe(true);
    expect(sent(ws).some((m) => m.type === "message")).toBe(false);
  });

  it("interroge bien chat_channels.organization_id avec l'org du jeton", async () => {
    const { emit } = await connect("org-a");
    await emit({ type: "message", channelId: "c1", content: "salut" });
    expect(eq).toHaveBeenCalledWith(chatChannels.organizationId, "org-a");
  });

  it("accepte un message sur un canal de la même organisation", async () => {
    const { ws, emit } = await connect("org-a");
    state.memberRow = [{ userId: "u1" }];
    await emit({ type: "message", channelId: "c1", content: "salut" });
    expect(sent(ws).some((m) => m.type === "message")).toBe(true);
  });
});

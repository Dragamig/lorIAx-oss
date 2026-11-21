import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  initRepository: vi.fn(),
  createSpaceChannel: vi.fn(),
  logActivity: vi.fn(),
  recordOnboardingEvent: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({ spaces: {} }));
vi.mock("@/lib/git/repository", () => ({ initRepository: mocks.initRepository }));
vi.mock("@/lib/chat/channel-hooks", () => ({ createSpaceChannel: mocks.createSpaceChannel }));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/onboarding/progress", () => ({ recordOnboardingEvent: mocks.recordOnboardingEvent }));
vi.mock("@/lib/logger", () => ({ default: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() } }));

import { afterSpaceCreated } from "../create-space";

const space = {
  id: "s1", name: "Espace", type: "team", organizationId: "org1", gitRepoPath: "team/espace-1",
} as Parameters<typeof afterSpaceCreated>[0];

describe("afterSpaceCreated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initRepository.mockResolvedValue(undefined);
    mocks.createSpaceChannel.mockResolvedValue(undefined);
    mocks.recordOnboardingEvent.mockResolvedValue(undefined);
  });

  it("git KO : gitOk false et ni canal, ni activité, ni onboarding", async () => {
    mocks.initRepository.mockRejectedValueOnce(new Error("git"));
    await expect(afterSpaceCreated(space, "u1")).resolves.toEqual({ gitOk: false });
    expect(mocks.createSpaceChannel).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
    expect(mocks.recordOnboardingEvent).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalled();
  });

  it("nominal : gitOk true et les trois effets appelés avec les bons arguments", async () => {
    await expect(afterSpaceCreated(space, "u1")).resolves.toEqual({ gitOk: true });
    expect(mocks.initRepository).toHaveBeenCalledWith("team/espace-1");
    expect(mocks.createSpaceChannel).toHaveBeenCalledWith({
      spaceId: "s1", organizationId: "org1", createdBy: "u1", memberIds: ["u1"],
    });
    expect(mocks.logActivity).toHaveBeenCalledWith({
      userId: "u1", action: "create", entityType: "space", entityId: "s1",
      metadata: { name: "Espace", type: "team" },
    });
    expect(mocks.recordOnboardingEvent).toHaveBeenCalledWith("u1", "space");
  });

  it("canal et onboarding rejetés : aucune levée, échecs journalisés", async () => {
    mocks.createSpaceChannel.mockRejectedValueOnce(new Error("canal"));
    mocks.recordOnboardingEvent.mockRejectedValueOnce(new Error("onboarding"));
    await expect(afterSpaceCreated(space, "u1")).resolves.toEqual({ gitOk: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.loggerError).toHaveBeenCalledTimes(2);
  });
});

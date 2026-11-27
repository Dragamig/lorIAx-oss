import { describe, it, expect, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-s3", () => {
  class Cmd {
    constructor(public input: unknown) {}
  }
  return {
    S3Client: class {
      send = send;
    },
    PutObjectCommand: Cmd,
    GetObjectCommand: Cmd,
    DeleteObjectCommand: Cmd,
    ListObjectsV2Command: Cmd,
    CopyObjectCommand: Cmd,
  };
});
vi.mock("@aws-sdk/lib-storage", () => ({ Upload: class {} }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }));

import { copyFile, BUCKET } from "./s3";

describe("copyFile", () => {
  it("copie côté serveur, source encodée par segment", async () => {
    send.mockResolvedValue({});
    await copyFile("space 1/a b.png", "space 1/c.png");
    const cmd = send.mock.calls[0][0] as { input: Record<string, string> };
    expect(cmd.input).toEqual({
      Bucket: BUCKET,
      Key: "space 1/c.png",
      CopySource: `${BUCKET}/space%201/a%20b.png`,
    });
  });

  it("propage l'échec", async () => {
    send.mockRejectedValue(new Error("boom"));
    await expect(copyFile("a", "b")).rejects.toThrow("boom");
  });
});

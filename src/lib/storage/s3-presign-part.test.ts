import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.S3_ENDPOINT = "garage-interne";
  process.env.S3_PORT = "3900";
  process.env.S3_ACCESS_KEY = "k";
  process.env.S3_SECRET_KEY = "s";
  process.env.S3_BUCKET = "b";
  process.env.S3_PUBLIC_URL = "https://files.loriax.example";
});

import { presignUploadPart } from "./s3";

describe("presignUploadPart", () => {
  it("l'URL commence par S3_PUBLIC_URL, jamais par l'hôte interne", async () => {
    const url = await presignUploadPart("org-x/y.mp4", "up-1", 3);
    expect(url.startsWith("https://files.loriax.example")).toBe(true);
    expect(url).not.toContain("garage-interne");
    expect(url).toContain("partNumber=3");
    expect(url).toContain("uploadId=up-1");
  });

  it("la taille de la part est signée (content-length) pour borner l'envoi", async () => {
    const url = await presignUploadPart("org-x/y.mp4", "up-1", 3, 16 * 1024 * 1024);
    const signed = new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "";
    expect(signed.split(";")).toContain("content-length");
  });

  it("sans taille, content-length n'est pas signé", async () => {
    const url = await presignUploadPart("org-x/y.mp4", "up-1", 3);
    const signed = new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "";
    expect(signed.split(";")).not.toContain("content-length");
  });
});

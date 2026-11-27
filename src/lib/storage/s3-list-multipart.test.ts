import { describe, it, expect, vi, beforeEach } from "vitest";

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
    CreateMultipartUploadCommand: Cmd,
    UploadPartCommand: Cmd,
    ListPartsCommand: Cmd,
    CompleteMultipartUploadCommand: Cmd,
    AbortMultipartUploadCommand: Cmd,
    ListMultipartUploadsCommand: Cmd,
    HeadObjectCommand: Cmd,
    GetBucketCorsCommand: Cmd,
    PutBucketCorsCommand: Cmd,
  };
});
vi.mock("@aws-sdk/lib-storage", () => ({ Upload: class {} }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }));

import { listMultipartUploads } from "./s3";

const page = (from: number, n: number, truncated: boolean) => ({
  Uploads: Array.from({ length: n }, (_, i) => ({
    Key: `k${from + i}`,
    UploadId: `u${from + i}`,
    Initiated: new Date(0),
  })),
  IsTruncated: truncated,
  NextKeyMarker: truncated ? `k${from + n - 1}` : undefined,
  NextUploadIdMarker: truncated ? `u${from + n - 1}` : undefined,
});

describe("listMultipartUploads", () => {
  beforeEach(() => send.mockReset());

  it("suit la pagination au-delà de 1000 sessions, marqueurs transmis", async () => {
    send
      .mockResolvedValueOnce(page(0, 1000, true))
      .mockResolvedValueOnce(page(1000, 1000, true))
      .mockResolvedValueOnce(page(2000, 5, false));
    const all = await listMultipartUploads();
    expect(all).toHaveLength(2005);
    expect(send).toHaveBeenCalledTimes(3);
    const second = send.mock.calls[1][0] as { input: Record<string, string> };
    expect(second.input).toMatchObject({ KeyMarker: "k999", UploadIdMarker: "u999" });
  });
});

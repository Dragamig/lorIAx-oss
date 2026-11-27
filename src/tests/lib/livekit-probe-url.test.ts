import { describe, it, expect } from "vitest";
import { livekitProbeUrl } from "@/lib/admin/livekit-probe-url";

describe("livekitProbeUrl", () => {
  it("convertit wss en https", () => {
    expect(livekitProbeUrl("wss://livekit.example.com")).toBe("https://livekit.example.com");
  });
  it("convertit ws en http", () => {
    expect(livekitProbeUrl("ws://livekit.interne:7880")).toBe("http://livekit.interne:7880");
  });
  it("laisse https et http inchangés", () => {
    expect(livekitProbeUrl("https://lk.exemple.tld")).toBe("https://lk.exemple.tld");
    expect(livekitProbeUrl("http://lk.exemple.tld")).toBe("http://lk.exemple.tld");
  });
});

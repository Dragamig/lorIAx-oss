import { describe, expect, it } from "vitest";
import { deriveRerankBaseUrl } from "./rerank-url";

describe("deriveRerankBaseUrl", () => {
  it("convertit l'URL Infomaniak OpenAI en URL Cohere", () => {
    expect(
      deriveRerankBaseUrl("https://api.infomaniak.com/2/ai/12345/openai/v1")
    ).toBe("https://api.infomaniak.com/2/ai/12345/cohere/v2");
  });

  it("tolere une barre oblique finale", () => {
    expect(
      deriveRerankBaseUrl("https://api.infomaniak.com/2/ai/12345/openai/v1/")
    ).toBe("https://api.infomaniak.com/2/ai/12345/cohere/v2");
  });

  it("laisse telle quelle une passerelle compatible Cohere", () => {
    expect(deriveRerankBaseUrl("https://passerelle.interne/v2")).toBe(
      "https://passerelle.interne/v2"
    );
  });

  it("rend null sans URL", () => {
    expect(deriveRerankBaseUrl(null)).toBeNull();
    expect(deriveRerankBaseUrl("")).toBeNull();
  });
});

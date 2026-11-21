// src/lib/images/unsplash.ts
import type { SearchResponse } from "./adapters";

export async function searchUnsplash(
  query: string,
  page: number,
  apiKey: string
): Promise<SearchResponse> {
  const url = query
    ? `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&page=${page}&per_page=20`
    : `https://api.unsplash.com/photos?page=${page}&per_page=20&order_by=popular`;

  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${apiKey}` },
    next: { revalidate: 300 },
  });

  if (!res.ok) throw new Error(`Unsplash error: ${res.status}`);

  const data = await res.json();
  const raw: unknown[] = Array.isArray(query ? data.results : data)
    ? (query ? data.results : data)
    : [];

  type UnsplashPhoto = { id: string; urls?: { small?: string; regular?: string }; alt_description?: string; description?: string; user?: { name?: string; links?: { html?: string } }; links?: { download_location?: string } };
  return {
    results: (raw as UnsplashPhoto[]).map((p) => ({
      id: p.id,
      thumb: p.urls?.small ?? "",
      regular: p.urls?.regular ?? "",
      description: p.alt_description || p.description || "",
      credit: p.user?.name ?? "",
      creditUrl: p.user?.links?.html ?? "",
      downloadLocation: p.links?.download_location,
    })),
    total: query ? (data.total ?? raw.length) : raw.length,
  };
}

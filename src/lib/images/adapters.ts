// src/lib/images/adapters.ts

export interface ImageSearchResult {
  id: string;
  thumb: string;
  regular: string;
  description: string;
  credit: string;
  creditUrl: string;
  downloadLocation?: string;
}

export interface SearchResponse {
  results: ImageSearchResult[];
  total: number;
}

export async function searchPexels(
  query: string,
  page: number,
  apiKey: string
): Promise<SearchResponse> {
  const url = query
    ? `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&page=${page}&per_page=20`
    : `https://api.pexels.com/v1/curated?page=${page}&per_page=20`;

  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) throw new Error(`Pexels error: ${res.status}`);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('Pexels: Invalid JSON response');
  }

  type PexelsPhoto = { id: number; src?: { small?: string; large?: string }; alt?: string; photographer?: string; photographer_url?: string };
  return {
    results: ((data.photos as PexelsPhoto[]) ?? []).map((p) => ({
      id: String(p.id),
      thumb: p.src?.small ?? "",
      regular: p.src?.large ?? "",
      description: p.alt || "",
      credit: p.photographer ?? "",
      creditUrl: p.photographer_url ?? "",
    })),
    total: data.total_results ?? data.photos?.length ?? 0,
  };
}

export async function searchPixabay(
  query: string,
  page: number,
  apiKey: string
): Promise<SearchResponse> {
  const url = `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(query || "nature")}&page=${page}&per_page=20&image_type=photo`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixabay error: ${res.status}`);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('Pixabay: Invalid JSON response');
  }

  type PixabayHit = { id: number; previewURL?: string; largeImageURL?: string; tags?: string; user?: string; user_id?: number };
  return {
    results: ((data.hits as PixabayHit[]) ?? []).map((p) => ({
      id: String(p.id),
      thumb: p.previewURL ?? "",
      regular: p.largeImageURL ?? "",
      description: p.tags || "",
      credit: p.user ?? "",
      creditUrl: p.user && p.user_id
        ? `https://pixabay.com/users/${p.user}-${p.user_id}/`
        : "",
    })),
    total: data.totalHits ?? 0,
  };
}

export async function searchShutterstock(
  query: string,
  page: number,
  apiKey: string
): Promise<SearchResponse> {
  const url = `https://api.shutterstock.com/v2/images/search?query=${encodeURIComponent(query || "nature")}&page=${page}&per_page=20`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Shutterstock error: ${res.status}`);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('Shutterstock: Invalid JSON response');
  }

  type ShutterstockImage = { id: string; assets?: { preview?: { url?: string }; preview_1500?: { url?: string } }; description?: string; contributor?: { id?: string } };
  return {
    results: ((data.data as ShutterstockImage[]) ?? []).map((p) => ({
      id: p.id,
      thumb: p.assets?.preview?.url ?? "",
      regular: p.assets?.preview_1500?.url ?? p.assets?.preview?.url ?? "",
      description: p.description || "",
      credit: p.contributor?.id ?? "",
      creditUrl: p.contributor?.id
        ? `https://www.shutterstock.com/g/${p.contributor.id}`
        : "",
    })),
    total: data.total_count ?? 0,
  };
}

export async function searchGetty(
  query: string,
  page: number,
  apiKey: string
): Promise<SearchResponse> {
  const url = `https://api.gettyimages.com/v3/search/images?phrase=${encodeURIComponent(query || "nature")}&page=${page}&page_size=20`;

  const res = await fetch(url, { headers: { "Api-Key": apiKey } });
  if (!res.ok) throw new Error(`Getty error: ${res.status}`);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('Getty: Invalid JSON response');
  }

  type GettyDisplaySize = { name: string; uri?: string };
  type GettyImage = { id: string; display_sizes?: GettyDisplaySize[]; title?: string; artist?: string };
  return {
    results: ((data.images as GettyImage[]) ?? []).map((p) => ({
      id: p.id,
      thumb:
        p.display_sizes?.find((s) => s.name === "thumb")?.uri ?? "",
      regular:
        p.display_sizes?.find((s) => s.name === "comp")?.uri ??
        p.display_sizes?.[0]?.uri ??
        "",
      description: p.title || "",
      credit: p.artist || "",
      creditUrl: p.artist
        ? `https://www.gettyimages.com/search/2/image?artist=${encodeURIComponent(p.artist)}`
        : "",
    })),
    total: data.result_count ?? 0,
  };
}

import { chunkText } from "@/lib/ai/embeddings";
import type { MediaTextSource } from "@/lib/db/schema-media-ai";
import { MAX_CHUNKS } from "./limits";

/** Taille cible d'un bloc de transcription (alignée sur `chunkText`). */
const TRANSCRIPT_CHUNK_CHARS = 1000;

/** Regroupe les lignes horodatées en blocs : un bloc commence toujours par un horodatage. */
function chunkTranscript(text: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  const flush = () => {
    if (current.length) chunks.push(current.join("\n"));
    current = [];
    size = 0;
  };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (line.length > TRANSCRIPT_CHUNK_CHARS) {
      flush();
      chunks.push(...chunkText(line));
      continue;
    }
    if (size + line.length + 1 > TRANSCRIPT_CHUNK_CHARS) flush();
    current.push(line);
    size += line.length + 1;
    if (chunks.length >= MAX_CHUNKS) break;
  }
  flush();
  return chunks;
}

/** Découpe le texte d'un média en au plus `MAX_CHUNKS` blocs ; une transcription se coupe sur les lignes horodatées. */
export function chunkMediaText(text: string, source: MediaTextSource): string[] {
  if (!text.trim()) return [];
  const chunks = source === "transcript" ? chunkTranscript(text) : chunkText(text);
  return chunks.slice(0, MAX_CHUNKS);
}

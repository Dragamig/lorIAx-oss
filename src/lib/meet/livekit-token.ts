import { AccessToken } from "livekit-server-sdk";
import { getLiveKitConfig } from "./livekit-config";

interface TokenPayload {
  roomName: string;
  userId: string;
  userName: string;
  userEmail: string;
  ttl?: string; // Optional TTL, defaults to "2h"
}

/**
 * Generate a LiveKit room join token using the server SDK.
 * Credentials are resolved via getLiveKitConfig() (system_settings DB,
 * with fallback to LIVEKIT_API_KEY / LIVEKIT_API_SECRET env vars).
 *
 * @param payload Token payload
 * @param payload.ttl Optional TTL (e.g., "1h", "2h"). Defaults to "2h".
 */
export async function generateLiveKitToken(
  payload: TokenPayload
): Promise<string> {
  const { livekitApiKey: apiKey, livekitApiSecret: apiSecret } =
    await getLiveKitConfig();

  if (!apiKey || !apiSecret) {
    throw new Error(
      "LiveKit non configuré (clés API absentes des réglages et de l'environnement)"
    );
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity: payload.userId,
    name: payload.userName,
    metadata: JSON.stringify({ email: payload.userEmail }),
    ttl: payload.ttl || "2h",
  });

  token.addGrant({
    room: payload.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return await token.toJwt();
}

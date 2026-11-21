import { WebSocket } from "ws";
import { db } from "@/lib/db";
import { chatChannelMembers, chatChannels, chatMessages } from "@/lib/db/schema-chat";
import { eq, and } from "drizzle-orm";
import { verifyWsToken } from "@/lib/collab/auth-ws";
import logger from "@/lib/logger";
import { notifyChannelMembers } from "./chat-notifications";

interface AuthedWs extends WebSocket {
  _userId?: string;
  _userName?: string;
  _orgId?: string;
  _authed?: boolean;
}

interface WsMessage {
  type: "auth" | "message" | "typing" | "read";
  token?: string;
  channelId?: string;
  content?: string;
}

export class ChatServer {
  private channels = new Map<string, Set<AuthedWs>>();
  private userSockets = new Map<string, AuthedWs>();
  private memberCache = new Map<string, { value: boolean; expiry: number }>();

  handleConnection(ws: AuthedWs): void {
    const authTimeout = setTimeout(() => {
      if (!ws._authed) {
        ws.close(4001, "Auth timeout");
      }
    }, 5000);

    ws.on("message", async (raw: Buffer) => {
      try {
        const msg: WsMessage = JSON.parse(raw.toString());
        if (msg.type === "auth") {
          clearTimeout(authTimeout);
          await this.handleAuth(ws, msg.token ?? "");
        } else if (ws._authed) {
          if (msg.type === "message") await this.handleMessage(ws, msg);
          else if (msg.type === "typing") this.handleTyping(ws, msg);
          else if (msg.type === "read") await this.handleRead(ws, msg);
        }
      } catch (err) {
        logger.error({ err }, "[chat-server] Erreur traitement message WS");
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimeout);
      if (ws._userId) {
        this.userSockets.delete(ws._userId);
        this.channels.forEach((sockets, channelId) => {
          sockets.delete(ws);
          if (sockets.size === 0) this.channels.delete(channelId);
        });
      }
    });
  }

  private async handleAuth(ws: AuthedWs, token: string): Promise<void> {
    const user = await verifyWsToken(token);
    if (!user) {
      ws.close(4003, "Unauthorized");
      return;
    }
    // Jeton sans organisation (émis avant le cloisonnement) : refus fail-closed
    if (!user.orgId) {
      ws.close(4003, "Unauthorized");
      return;
    }
    ws._orgId = user.orgId;
    ws._userId = user.id;
    ws._userName = user.name ?? "";
    ws._authed = true;
    this.userSockets.set(user.id, ws);
    // Précharger les canaux de l'utilisateur au moment de l'auth
    // Seuls les canaux de l'organisation du jeton sont préchargés
    db.select({ channelId: chatChannelMembers.channelId })
      .from(chatChannelMembers)
      .innerJoin(chatChannels, eq(chatChannels.id, chatChannelMembers.channelId))
      .where(
        and(
          eq(chatChannelMembers.userId, user.id),
          eq(chatChannels.organizationId, user.orgId)
        )
      )
      .then((rows) => {
        rows.forEach(({ channelId }) => {
          if (!this.channels.has(channelId)) this.channels.set(channelId, new Set());
          this.channels.get(channelId)!.add(ws);
          this.memberCache.set(`${user.orgId}:${channelId}:${user.id}`, { value: true, expiry: Date.now() + 60_000 });
        });
      })
      .catch((err) => logger.error({ err }, "[chat-server] Erreur préchargement canaux"));
    ws.send(JSON.stringify({ type: "auth_ok", userId: user.id }));
    logger.info({ userId: user.id }, "[chat-server] Connexion authentifiée");
  }

  private async handleMessage(ws: AuthedWs, msg: WsMessage): Promise<void> {
    if (!msg.channelId || !msg.content?.trim() || !ws._userId) return;

    const isMember = await this.checkMembership(ws._userId, msg.channelId, ws._orgId);
    if (!isMember) {
      ws.send(JSON.stringify({ type: "error", code: 403, message: "Non membre du canal" }));
      return;
    }

    const [inserted] = await db
      .insert(chatMessages)
      .values({
        channelId: msg.channelId,
        authorId: ws._userId,
        content: msg.content.trim(),
      })
      .returning();

    const payload = JSON.stringify({
      type: "message",
      id: inserted.id,
      channelId: inserted.channelId,
      authorId: ws._userId,
      authorName: ws._userName,
      content: inserted.content,
      createdAt: inserted.createdAt,
    });

    this.broadcast(msg.channelId, payload);

    const connectedIds = this.getConnectedUserIds(msg.channelId);
    notifyChannelMembers({
      channelId: msg.channelId,
      authorId: ws._userId,
      messageId: inserted.id,
      content: inserted.content ?? "",
      connectedUserIds: connectedIds,
    }).catch((err) => logger.error({ err }, "[chat-server] Erreur notification"));
  }

  private handleTyping(ws: AuthedWs, msg: WsMessage): void {
    if (!msg.channelId || !ws._userId) return;
    // Le socket ne figure dans un canal qu'après contrôle d'appartenance
    if (!this.channels.get(msg.channelId)?.has(ws)) return;
    const payload = JSON.stringify({
      type: "typing",
      channelId: msg.channelId,
      userId: ws._userId,
      userName: ws._userName,
    });
    this.broadcastExcept(msg.channelId, ws, payload);
  }

  private async handleRead(ws: AuthedWs, msg: WsMessage): Promise<void> {
    if (!msg.channelId || !ws._userId) return;
    const isMember = await this.checkMembership(ws._userId, msg.channelId, ws._orgId);
    if (!isMember) return;
    await db
      .update(chatChannelMembers)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(chatChannelMembers.channelId, msg.channelId),
          eq(chatChannelMembers.userId, ws._userId)
        )
      );
  }

  private broadcast(channelId: string, payload: string): void {
    const sockets = this.channels.get(channelId);
    if (!sockets) return;
    sockets.forEach((client) => {
      if (client.readyState === 1) client.send(payload);
    });
  }

  private broadcastExcept(channelId: string, exclude: AuthedWs, payload: string): void {
    const sockets = this.channels.get(channelId);
    if (!sockets) return;
    sockets.forEach((client) => {
      if (client !== exclude && client.readyState === 1) client.send(payload);
    });
  }

  /**
   * Membre du canal ET canal appartenant à l'organisation du jeton. Un canal
   * d'une autre organisation donne la même réponse qu'un canal inexistant
   * (aucun oracle d'existence).
   */
  private async checkMembership(
    userId: string,
    channelId: string,
    orgId: string | undefined
  ): Promise<boolean> {
    if (!orgId) return false;
    const key = `${orgId}:${channelId}:${userId}`;
    const cached = this.memberCache.get(key);
    if (cached && cached.expiry > Date.now()) return cached.value;

    const [row] = await db
      .select({ userId: chatChannelMembers.userId })
      .from(chatChannelMembers)
      .innerJoin(chatChannels, eq(chatChannels.id, chatChannelMembers.channelId))
      .where(
        and(
          eq(chatChannelMembers.channelId, channelId),
          eq(chatChannelMembers.userId, userId),
          eq(chatChannels.organizationId, orgId)
        )
      )
      .limit(1);

    const value = !!row;
    this.memberCache.set(key, { value, expiry: Date.now() + 60_000 });

    if (value) {
      const socket = this.userSockets.get(userId);
      if (socket) {
        if (!this.channels.has(channelId)) this.channels.set(channelId, new Set());
        this.channels.get(channelId)!.add(socket);
      }
    }

    return value;
  }

  /** Expose l'ensemble des userIds connectés dans un canal (pour les notifications) */
  getConnectedUserIds(channelId: string): Set<string> {
    const result = new Set<string>();
    const sockets = this.channels.get(channelId);
    if (!sockets) return result;
    sockets.forEach((ws) => {
      if (ws._userId) result.add(ws._userId);
    });
    return result;
  }
}

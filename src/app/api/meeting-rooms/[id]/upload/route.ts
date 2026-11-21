import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { meetingRooms } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { uploadFile, deleteFile, s3Client, BUCKET } from "@/lib/storage/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSessionUser } from "@/lib/auth/get-user";
import { guardMeetingRoomsEnabled } from "@/lib/meeting-rooms/guards";
import { canManageRooms } from "@/lib/meeting-rooms/permissions";
import { getMeetingRoomForRequest } from "@/lib/meeting-rooms/scoped-room";

const MAX_SIZE = 5 * 1024 * 1024; // 5 Mo
const PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const PLAN_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const MAGIC: Array<{ bytes: number[]; mime: string }> = [
  { bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg" },
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: "image/png" },
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: "image/webp" }, // RIFF
];

function detectMime(buffer: Buffer): string | null {
  for (const sig of MAGIC) {
    if (buffer.length < sig.bytes.length) continue;
    const match = sig.bytes.every((b, i) => buffer[i] === b);
    if (!match) continue;
    if (sig.mime === "image/webp") {
      if (buffer.length >= 12 && buffer.toString("ascii", 8, 12) === "WEBP") {
        return "image/webp";
      }
      continue;
    }
    return sig.mime;
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!canManageRooms(user.globalRole, user.capabilities)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id } = await params;

  // Cloisonnement multi-tenant : 404 si la salle relève d'une autre org.
  const room = await getMeetingRoomForRequest(id, user);
  if (!room) {
    return NextResponse.json({ error: "Salle introuvable" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const type = formData.get("type") as string | null;

  if (!file) {
    return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });
  }
  if (!type || !["photo", "floor_plan"].includes(type)) {
    return NextResponse.json({ error: "Type invalide (photo ou floor_plan)" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Fichier trop volumineux (max 5 Mo)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = detectMime(buffer);
  const allowed = type === "photo" ? PHOTO_MIME : PLAN_MIME;
  if (!detected || !allowed.has(detected)) {
    return NextResponse.json(
      { error: "Format non supporté. Utilisez JPG, PNG ou WebP." },
      { status: 400 }
    );
  }

  const processed = await sharp(buffer)
    .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();

  const key = `meeting-rooms/${id}/${type === "photo" ? "photo" : "floor-plan"}.webp`;

  // Supprime l'ancienne clé si format différent
  const previousKey = type === "photo" ? room.photoKey : room.floorPlanKey;
  if (previousKey && previousKey !== key) {
    deleteFile(previousKey).catch(() => {
      // best-effort
    });
  }

  try {
    await uploadFile(key, processed, "image/webp");
  } catch (error) {
    console.error("S3 upload failed:", error);
    return NextResponse.json(
      { error: "Erreur lors du téléchargement du fichier" },
      { status: 500 }
    );
  }

  await db
    .update(meetingRooms)
    .set(
      type === "photo"
        ? { photoKey: key, updatedAt: new Date() }
        : { floorPlanKey: key, updatedAt: new Date() }
    )
    .where(eq(meetingRooms.id, id));

  return NextResponse.json({ key });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const type = request.nextUrl.searchParams.get("type");
  if (!type || !["photo", "floor_plan"].includes(type)) {
    return NextResponse.json({ error: "Type invalide" }, { status: 400 });
  }

  // Cloisonnement multi-tenant : 404 si la salle relève d'une autre org.
  const room = await getMeetingRoomForRequest(id, user);
  if (!room) {
    return NextResponse.json({ error: "Salle introuvable" }, { status: 404 });
  }

  const key = type === "photo" ? room.photoKey : room.floorPlanKey;
  if (!key) {
    return NextResponse.json({ error: "Image introuvable" }, { status: 404 });
  }

  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const response = await s3Client.send(command);
    if (!response.Body) {
      return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
    }
    const bytes = await response.Body.transformToByteArray();
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  }
}

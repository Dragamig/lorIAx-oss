/**
 * Seed de démo — Salles de réunion (Sprint 12)
 *
 * Usage : npx tsx scripts/seed-meeting-rooms.ts
 *
 * Crée 2 salles d'exemple. Idempotent : ne fait rien si une salle
 * portant l'un des noms ciblés existe déjà.
 *
 * Note : nécessite que le module soit activable. Active aussi le flag
 * meeting_rooms_enabled dans system_settings si --enable est passé.
 */
import { db } from "../src/lib/db";
import {
  meetingRooms,
  systemSettings,
  users,
} from "../src/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

const DEMO_ROOMS = [
  {
    name: "Salle Atlas",
    address: "Siège, 12 rue du Faubourg, 75010 Paris",
    floor: "2e étage, aile sud",
    capacity: 12,
    description:
      "Grande salle équipée d'un vidéoprojecteur 4K et d'un système de visio LiveKit.",
    equipment: ["Vidéoprojecteur 4K", "Visioconférence", "Tableau blanc", "Café"],
    openingHours: {
      mon: [{ from: "08:00", to: "19:00" }],
      tue: [{ from: "08:00", to: "19:00" }],
      wed: [{ from: "08:00", to: "19:00" }],
      thu: [{ from: "08:00", to: "19:00" }],
      fri: [{ from: "08:00", to: "18:00" }],
      sat: [],
      sun: [],
    },
  },
  {
    name: "Salle Mercure",
    address: "Siège, 12 rue du Faubourg, 75010 Paris",
    floor: "Rez-de-chaussée",
    capacity: 4,
    description: "Petite salle conviviale pour brainstorming et entretiens 1:1.",
    equipment: ["Écran 27\"", "Tableau blanc"],
    openingHours: {
      mon: [{ from: "08:30", to: "12:30" }, { from: "13:30", to: "18:30" }],
      tue: [{ from: "08:30", to: "12:30" }, { from: "13:30", to: "18:30" }],
      wed: [{ from: "08:30", to: "12:30" }, { from: "13:30", to: "18:30" }],
      thu: [{ from: "08:30", to: "12:30" }, { from: "13:30", to: "18:30" }],
      fri: [{ from: "08:30", to: "12:30" }, { from: "13:30", to: "17:00" }],
      sat: [],
      sun: [],
    },
  },
];

async function main() {
  console.log("→ Seed des salles de réunion");

  // Choisit le premier admin/super_admin disponible comme created_by
  const admins = await db
    .select()
    .from(users)
    .where(inArray(users.globalRole, ["admin", "super_admin"]))
    .limit(1);
  if (admins.length === 0) {
    console.error("✗ Aucun admin trouvé. Lancez d'abord npm run db:seed.");
    process.exit(1);
  }
  const createdBy = admins[0].id;

  let created = 0;
  let skipped = 0;
  for (const room of DEMO_ROOMS) {
    const existing = await db
      .select({ id: meetingRooms.id })
      .from(meetingRooms)
      .where(eq(meetingRooms.name, room.name))
      .limit(1);
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await db.insert(meetingRooms).values({
      name: room.name,
      address: room.address,
      floor: room.floor,
      capacity: room.capacity,
      description: room.description,
      equipment: room.equipment,
      openingHours: room.openingHours,
      isActive: true,
      createdBy,
    });
    created++;
  }

  // Active le flag si --enable passé en CLI
  if (process.argv.includes("--enable")) {
    await db
      .insert(systemSettings)
      .values({ key: "meeting_rooms_enabled", value: true, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: true, updatedAt: new Date() },
      });
    console.log("✓ Module activé dans system_settings");
  }

  console.log(`✓ ${created} salle(s) créée(s), ${skipped} déjà existante(s)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ Échec du seed:", err);
  process.exit(1);
});

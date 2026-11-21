import { redirect } from "next/navigation";
import { isMeetingRoomsEnabled } from "@/lib/meeting-rooms/feature-flag";
import { getModuleScopeOrgId } from "@/lib/modules/org-context";
import { RoomDetailClient } from "./room-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SalleDetailPage({ params }: Props) {
  const enabled = await isMeetingRoomsEnabled(await getModuleScopeOrgId());
  if (!enabled) redirect("/organisation");
  const { id } = await params;
  return <RoomDetailClient roomId={id} />;
}

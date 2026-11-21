"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  DoorOpen,
  Plus,
  Trash2,
  Pencil,
  ImageIcon,
  Loader2,
  Users,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OpeningHoursEditor } from "@/components/meeting-rooms/opening-hours-editor";
import { EquipmentInput } from "@/components/meeting-rooms/equipment-input";
import { PermissionsMatrix } from "@/components/meeting-rooms/permissions-matrix";
import type { MeetingRoom, OpeningHours } from "@/types";

const DEFAULT_HOURS: OpeningHours = {
  mon: [{ from: "08:00", to: "19:00" }],
  tue: [{ from: "08:00", to: "19:00" }],
  wed: [{ from: "08:00", to: "19:00" }],
  thu: [{ from: "08:00", to: "19:00" }],
  fri: [{ from: "08:00", to: "19:00" }],
  sat: [],
  sun: [],
};

type DialogMode = "create" | "edit" | null;

export function AdminMeetingRoomsTab() {
  const [rooms, setRooms] = useState<MeetingRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<DialogMode>(null);
  const [editingRoom, setEditingRoom] = useState<MeetingRoom | null>(null);
  const [permsRoomId, setPermsRoomId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/meeting-rooms");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRooms(data);
    } catch {
      toast.error("Impossible de charger les salles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(room: MeetingRoom) {
    if (!confirm(`Supprimer la salle « ${room.name} » ? Toutes les réservations associées seront annulées.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/meeting-rooms/${room.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erreur lors de la suppression");
      }
      toast.success("Salle supprimée");
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur lors de la suppression";
      toast.error(msg);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DoorOpen className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Salles de réunion</h2>
            <p className="text-sm text-muted-foreground">
              Créez des salles, gérez l&apos;équipement, les horaires et les
              autorisations de réservation.
            </p>
          </div>
        </div>
        <Button
          onClick={() => {
            setEditingRoom(null);
            setMode("create");
          }}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Nouvelle salle
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : rooms.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <DoorOpen className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Aucune salle enregistrée</p>
          <p className="text-xs text-muted-foreground">
            Cliquez sur « Nouvelle salle » pour commencer.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {rooms.map((room) => (
            <article
              key={room.id}
              className="rounded-lg border border-border bg-card p-4 space-y-3"
            >
              <header className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{room.name}</h3>
                  {room.address && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {room.address}
                      {room.floor && ` · ${room.floor}`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setEditingRoom(room);
                      setMode("edit");
                    }}
                    aria-label="Modifier"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPermsRoomId(room.id)}
                    aria-label="Gérer les droits"
                  >
                    <Users className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(room)}
                    aria-label="Supprimer"
                    className="text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </header>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>Capacité : {room.capacity}</span>
                {!room.isActive && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                    Inactive
                  </span>
                )}
              </div>

              {Array.isArray(room.equipment) && (room.equipment as string[]).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(room.equipment as string[]).map((e) => (
                    <span
                      key={e}
                      className="rounded-full bg-secondary px-2 py-0.5 text-xs"
                    >
                      {e}
                    </span>
                  ))}
                </div>
              )}

              {room.photoKey && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ImageIcon className="h-3.5 w-3.5" />
                  Photo enregistrée
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <RoomFormDialog
        mode={mode}
        room={editingRoom}
        onClose={() => {
          setMode(null);
          setEditingRoom(null);
        }}
        onSaved={() => {
          setMode(null);
          setEditingRoom(null);
          load();
        }}
      />

      <Dialog open={permsRoomId !== null} onOpenChange={(open) => !open && setPermsRoomId(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Autorisations de réservation</DialogTitle>
            <DialogDescription>
              Sélectionnez qui peut réserver cette salle.
            </DialogDescription>
          </DialogHeader>
          {permsRoomId && <PermissionsMatrix roomId={permsRoomId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface RoomFormProps {
  mode: DialogMode;
  room: MeetingRoom | null;
  onClose: () => void;
  onSaved: () => void;
}

function RoomFormDialog({ mode, room, onClose, onSaved }: RoomFormProps) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [floor, setFloor] = useState("");
  const [capacity, setCapacity] = useState(8);
  const [description, setDescription] = useState("");
  const [equipment, setEquipment] = useState<string[]>([]);
  const [openingHours, setOpeningHours] = useState<OpeningHours>(DEFAULT_HOURS);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === null) return;
    if (room) {
      setName(room.name);
      setAddress(room.address ?? "");
      setFloor(room.floor ?? "");
      setCapacity(room.capacity);
      setDescription(room.description ?? "");
      setEquipment((room.equipment as string[]) ?? []);
      setOpeningHours((room.openingHours as OpeningHours) ?? DEFAULT_HOURS);
      setIsActive(room.isActive);
    } else {
      setName("");
      setAddress("");
      setFloor("");
      setCapacity(8);
      setDescription("");
      setEquipment([]);
      setOpeningHours(DEFAULT_HOURS);
      setIsActive(true);
    }
    setPhotoFile(null);
    setPlanFile(null);
    setNameError(null);
    setApiError(null);
  }, [mode, room]);

  async function handleSave() {
    if (!name.trim()) {
      setNameError("Le nom de la salle est requis.");
      return;
    }
    setNameError(null);
    setApiError(null);
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        address: address.trim() || null,
        floor: floor.trim() || null,
        capacity: Number(capacity) || 0,
        description: description.trim() || null,
        equipment,
        openingHours,
        isActive,
      };

      let savedId = room?.id;
      if (mode === "create") {
        const res = await fetch("/api/meeting-rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Erreur de création");
        }
        const created = await res.json();
        savedId = created.id;
      } else if (mode === "edit" && room) {
        const res = await fetch(`/api/meeting-rooms/${room.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Erreur de mise à jour");
        }
      }

      // Uploads optionnels
      if (savedId && photoFile) await uploadAsset(savedId, "photo", photoFile);
      if (savedId && planFile) await uploadAsset(savedId, "floor_plan", planFile);

      toast.success(mode === "create" ? "Salle créée" : "Salle mise à jour");
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Une erreur est survenue.";
      setApiError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function uploadAsset(id: string, type: "photo" | "floor_plan", file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("type", type);
    const res = await fetch(`/api/meeting-rooms/${id}/upload`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Échec de l'upload");
    }
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Nouvelle salle" : "Modifier la salle"}
          </DialogTitle>
          <DialogDescription>
            Renseignez les informations visibles par les utilisateurs autorisés.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {apiError && (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
              {apiError}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="room-name">
                Nom
                <span className="ml-1 text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input
                id="room-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (e.target.value.trim()) setNameError(null);
                }}
                placeholder="Salle Atlas"
                autoFocus
                aria-invalid={nameError ? "true" : undefined}
                className={nameError ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {nameError && (
                <p className="text-xs text-destructive">{nameError}</p>
              )}
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="room-address">Adresse</Label>
              <Input
                id="room-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="3 rue de la République, 75001 Paris"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="room-floor">Étage / repère</Label>
              <Input
                id="room-floor"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                placeholder="2e étage, aile sud"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="room-capacity">Capacité (personnes)</Label>
              <Input
                id="room-capacity"
                type="number"
                min={0}
                max={10000}
                value={capacity}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setCapacity(isNaN(v) ? 0 : Math.max(0, Math.min(10000, v)));
                }}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="room-description">Description</Label>
              <Textarea
                id="room-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Visioconférence, capacité projection 4K…"
                rows={3}
              />
            </div>
          </div>

          <EquipmentInput value={equipment} onChange={setEquipment} />
          <OpeningHoursEditor value={openingHours} onChange={setOpeningHours} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="room-photo">Photo</Label>
              <Input
                id="room-photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                JPG, PNG ou WebP, 5 Mo max.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="room-plan">Plan</Label>
              <Input
                id="room-plan"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setPlanFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Image du plan de la salle (optionnel).
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">Salle active</p>
              <p className="text-xs text-muted-foreground">
                Décochez pour suspendre temporairement les réservations.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsActive((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isActive ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"
              }`}
              aria-label="Activer la salle"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isActive ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {mode === "create" ? "Créer" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

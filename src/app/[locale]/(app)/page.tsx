"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Link } from "@/i18n/routing";
import { useCurrentUser } from "@/hooks/use-session";
import { useFavoritesContext, type ResolvedFavorite } from "@/hooks/use-favorites";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  FileText,
  Plus,
  Clock,
  Sparkles,
  Network,
  Search,
  CalendarDays,
  MapPin,
  LayoutTemplate,
  Star,
  Layers,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { FavoriteStar } from "@/components/ui/favorite-star";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

interface RecentDoc {
  id: string;
  title: string;
  spaceSlug: string;
  spaceName: string;
  updatedAt: string;
}

interface UpcomingEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location?: string;
  calendarId: string;
}

const BADGE_COLORS: Record<string, string> = {
  document: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  space: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  template: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  calendar_event: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  meeting: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

function getEntityIcon(entityType: string) {
  switch (entityType) {
    case "document": return FileText;
    case "space": return Layers;
    case "template": return LayoutTemplate;
    case "calendar_event": return CalendarDays;
    case "meeting": return Video;
    default: return FileText;
  }
}

function getEntityTypeLabel(entityType: string, t: ReturnType<typeof useTranslations<"home">>): string {
  switch (entityType) {
    case "document": return t("entityTypes.document");
    case "space": return t("entityTypes.space");
    case "template": return t("entityTypes.template");
    case "calendar_event": return t("entityTypes.calendarEvent");
    case "meeting": return t("entityTypes.meeting");
    default: return entityType;
  }
}

function SortableFavoriteCard({ favorite }: { favorite: ResolvedFavorite }) {
  const t = useTranslations("home");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: favorite.id });
  const Icon = getEntityIcon(favorite.entityType);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <Link href={favorite.href}>
        <div
          className={cn(
            "p-3 rounded-xl border border-border hover:border-primary/50 hover:bg-secondary/50 transition-all cursor-grab active:cursor-grabbing",
            isDragging && "opacity-50"
          )}
        >
          <div className="flex items-center gap-2 mb-1.5">
            {favorite.icon ? (
              <span className="text-base shrink-0">{favorite.icon}</span>
            ) : (
              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span className="text-sm font-medium truncate flex-1">{favorite.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", BADGE_COLORS[favorite.entityType] ?? "bg-muted text-muted-foreground")}>
              {getEntityTypeLabel(favorite.entityType, t)}
            </span>
            {favorite.subtitle && (
              <span className="text-xs text-muted-foreground truncate">{favorite.subtitle}</span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}

export default function HomePage() {
  const t = useTranslations("home");
  const format = useFormatter();
  const user = useCurrentUser();
  const { favorites, reorderFavorites, isFavorite, toggleFavorite } = useFavoritesContext();
  const [recentDocs, setRecentDocs] = useState<RecentDoc[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; icon: string; category: string; description: string }[]>([]);
  const [activeFavDrag, setActiveFavDrag] = useState<ResolvedFavorite | null>(null);
  // Evite le flash « aucun document » -> liste : on affiche un skeleton tant que
  // le 1er fetch des documents recents n'a pas repondu.
  const [recentLoading, setRecentLoading] = useState(true);

  const favSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const handleFavDragStart = useCallback((event: DragStartEvent) => {
    const fav = favorites.find((f) => f.id === event.active.id);
    setActiveFavDrag(fav ?? null);
  }, [favorites]);

  const handleFavDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveFavDrag(null);
    if (!over || active.id === over.id) return;
    const oldIndex = favorites.findIndex((f) => f.id === active.id);
    const newIndex = favorites.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(favorites, oldIndex, newIndex);
    reorderFavorites(reordered.map((f) => f.id));
  }, [favorites, reorderFavorites]);

  useEffect(() => {
    fetch("/api/documents/recent?limit=10")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setRecentDocs(data);
      })
      .catch(() => {})
      .finally(() => setRecentLoading(false));

    fetch("/api/templates")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTemplates(data);
      })
      .catch(() => {});

    // Fetch upcoming events (next 7 days)
    const now = new Date();
    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    fetch("/api/calendars")
      .then((r) => r.json())
      .then(async (calendars) => {
        if (!Array.isArray(calendars) || calendars.length === 0) return;
        const allEvents: UpcomingEvent[] = [];
        const start = now.toISOString();
        const end = weekLater.toISOString();
        await Promise.all(
          calendars.slice(0, 10).map(async (cal: { id: string }) => {
            try {
              const r = await fetch(`/api/calendars/${cal.id}/events?start=${start}&end=${end}`);
              if (r.ok) {
                const events = await r.json();
                allEvents.push(...events.slice(0, 20));
              }
            } catch {}
          })
        );
        allEvents.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
        setUpcomingEvents(allEvents.slice(0, 5));
      })
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 md:px-8 md:py-12">
      <div className="mb-10 flex items-center gap-4">
        {user && (
          <UserAvatar
            email={user.email}
            avatarUrl={user.avatarUrl}
            size={48}
          />
        )}
        <div>
          <h1 className="text-2xl font-bold mb-1">
            {user?.name
              ? t("greetingWithName", { name: user.name.split(" ")[0] })
              : t("greetingWithoutName")}
          </h1>
          <p className="text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
      </div>

      {/* Actions rapides */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        <Link href="/new">
          <div className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-secondary/50 transition-all cursor-pointer">
            <Plus className="h-6 w-6 text-primary" />
            <span className="text-sm font-medium">{t("quickActions.newDocument")}</span>
          </div>
        </Link>
        <Link href="/search">
          <div className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-secondary/50 transition-all cursor-pointer">
            <Search className="h-6 w-6 text-primary" />
            <span className="text-sm font-medium">{t("quickActions.search")}</span>
          </div>
        </Link>
        <Link href="/graph">
          <div className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-secondary/50 transition-all cursor-pointer">
            <Network className="h-6 w-6 text-primary" />
            <span className="text-sm font-medium">{t("quickActions.graph")}</span>
          </div>
        </Link>
        <Link href="/ai">
          <div className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-secondary/50 transition-all cursor-pointer">
            <Sparkles className="h-6 w-6 text-primary" />
            <span className="text-sm font-medium">{t("quickActions.aiAssistant")}</span>
          </div>
        </Link>
      </div>

      {/* Favoris — grille repositionnable */}
      {favorites.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Star className="h-4 w-4 text-yellow-500" />
            <h2 className="text-lg font-semibold">{t("sections.favorites")}</h2>
          </div>
          <DndContext
            sensors={favSensors}
            collisionDetection={closestCenter}
            onDragStart={handleFavDragStart}
            onDragEnd={handleFavDragEnd}
          >
            <SortableContext items={favorites.map((f) => f.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {favorites.map((fav) => (
                  <SortableFavoriteCard key={fav.id} favorite={fav} />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeFavDrag && (
                <div className="p-3 rounded-xl bg-popover border border-border shadow-lg">
                  <div className="flex items-center gap-2">
                    {activeFavDrag.icon ? (
                      <span className="text-base">{activeFavDrag.icon}</span>
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium truncate">{activeFavDrag.title}</span>
                  </div>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      {/* Documents récents */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">{t("sections.recentDocs")}</h2>
        </div>

        {recentLoading ? (
          <div className="space-y-1" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <div className="h-4 w-4 rounded bg-muted animate-pulse flex-shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="h-3.5 w-1/2 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-1/4 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : recentDocs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border">
            <EmptyState
              icon={FileText}
              title={t("emptyDocs.title")}
              description={t("emptyDocs.description")}
              action={
                <Link href="/new">
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    {t("emptyDocs.action")}
                  </Button>
                </Link>
              }
            />
          </div>
        ) : (
          <div className="space-y-1">
            {recentDocs.map((doc) => (
              <Link
                key={doc.id}
                href={`/s/${doc.spaceSlug}/${doc.id}`}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/50 transition-colors"
              >
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{doc.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.spaceName}
                  </p>
                </div>
                <FavoriteStar
                  entityType="document"
                  entityId={doc.id}
                  isFavorite={isFavorite("document", doc.id)}
                  onToggle={() => toggleFavorite("document", doc.id)}
                  size={14}
                />
                <span className="text-xs text-muted-foreground">
                  {format.dateTime(new Date(doc.updatedAt), { year: "numeric", month: "short", day: "numeric" })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
      {/* Templates rapides */}
      {templates.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{t("sections.templates")}</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {templates.map((tmpl) => (
              <Link key={tmpl.id} href={`/new?template=${tmpl.id}`}>
                <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-secondary/50 transition-all cursor-pointer">
                  <span className="text-lg shrink-0">{tmpl.icon || "📝"}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{tmpl.name}</p>
                    {tmpl.description && (
                      <p className="text-xs text-muted-foreground truncate">{tmpl.description}</p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Prochains événements */}
      {upcomingEvents.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{t("sections.events")}</h2>
            <Link href="/calendar" className="ml-auto text-xs text-primary hover:underline">
              {t("sections.seeAll")}
            </Link>
          </div>
          <div className="space-y-1">
            {upcomingEvents.map((ev) => {
              const start = new Date(ev.startAt);
              const isToday = start.toDateString() === new Date().toDateString();
              return (
                <Link
                  key={`${ev.id}-${ev.startAt}`}
                  href="/calendar"
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-secondary/50 transition-colors"
                >
                  <div className="w-10 text-center flex-shrink-0">
                    <div className="text-[10px] text-muted-foreground uppercase">
                      {format.dateTime(start, { weekday: "short" })}
                    </div>
                    <div className={`text-sm font-bold ${isToday ? "text-primary" : ""}`}>
                      {start.getDate()}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ev.title}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {ev.allDay
                        ? t("events.allDay")
                        : `${format.dateTime(start, { hour: "2-digit", minute: "2-digit" })} – ${format.dateTime(new Date(ev.endAt), { hour: "2-digit", minute: "2-digit" })}`}
                      {ev.location && (
                        <>
                          <MapPin className="h-3 w-3 ml-2" />
                          <span className="truncate">{ev.location}</span>
                        </>
                      )}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}

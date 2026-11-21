"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { apiPost, fetchJson } from "@/components/editor/extensions/database-block/api";
import { formatMention, MAX_COMMENT_LENGTH, parseMentionSegments } from "@/lib/databases/row-comment-mentions";
import type { PermissionLevel } from "@/types";
import { MentionList, mentionOptionId, type MentionCandidate } from "./mention-list";

export const COUNTER_THRESHOLD = 4500;
export const MENTION_DEBOUNCE_MS = 200;
const MENTION_LIMIT = 8;
const MENTION_QUERY_MAX = 30;

export interface CommentComposerProps {
  databaseId: string;
  rowId: string;
  permission: PermissionLevel | null;
  onPublished?: (commentId: string) => void;
  onUndo?: (commentId: string) => Promise<void>;
  /** In-place editing of an existing comment: the same area, saved through `onSave` instead of a new POST. */
  edit?: {
    initialBody: string;
    onSave: (body: string) => Promise<void>;
    onCancel: () => void;
  };
}

interface PickedMention {
  name: string;
  id: string;
}

function neutralName(name: string): string {
  const seg = parseMentionSegments(formatMention(name, "00000000-0000-0000-0000-000000000000"))[0];
  return seg && seg.type === "mention" ? seg.label : name;
}

const BOUNDARY = /[\s.,;:!?)\]}"'»]/;

/** Garde les mentions choisies dont le texte « @Nom » figure encore (suivi d'une limite) dans la zone. */
export function pruneMentions(text: string, picked: PickedMention[]): PickedMention[] {
  return picked.filter((p) => tokenIndexes(text, `@${neutralName(p.name)}`).length > 0);
}

function tokenIndexes(text: string, token: string): number[] {
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(token, from);
    if (at < 0) return out;
    const next = text[at + token.length];
    if (next === undefined || BOUNDARY.test(next)) out.push(at);
    from = at + 1;
  }
}

/** Remplace chaque « @Nom » choisi par son balisage : une occurrence par choix, sans dépendre de l'ordre. */
export function buildBody(text: string, picked: PickedMention[]): string {
  const used = new Set<number>();
  const spans: { at: number; len: number; md: string }[] = [];
  for (const p of picked) {
    const token = `@${neutralName(p.name)}`;
    const at = tokenIndexes(text, token).find((i) => !used.has(i));
    if (at === undefined) continue;
    used.add(at);
    spans.push({ at, len: token.length, md: formatMention(p.name, p.id) });
  }
  spans.sort((x, y) => x.at - y.at);
  let out = "";
  let from = 0;
  for (const sp of spans) {
    out += text.slice(from, sp.at) + sp.md;
    from = sp.at + sp.len;
  }
  return (out + text.slice(from)).trim();
}

/** Editable text of a stored body: each mention becomes « @Nom », remembered as a picked mention. */
function editableFromBody(body: string): { text: string; picked: PickedMention[] } {
  let text = "";
  const picked: PickedMention[] = [];
  for (const seg of parseMentionSegments(body)) {
    if (seg.type === "text") text += seg.text;
    else {
      text += `@${seg.label}`;
      picked.push({ name: seg.label, id: seg.userId });
    }
  }
  return { text, picked };
}

const codePoints = (s: string) => [...s].length;

/** Texte « @requête » juste avant le curseur, ou null. */
function activeQuery(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const m = /(^|\s)@([^\n@]*)$/.exec(before);
  if (!m || m[2].length > MENTION_QUERY_MAX) return null;
  return { start: before.length - m[2].length - 1, query: m[2] };
}

export function CommentComposer({ databaseId, rowId, permission, onPublished, onUndo, edit }: CommentComposerProps) {
  const t = useTranslations("rowActivity");
  const uid = useId();
  const listId = `${uid}-mentions`;
  const isViewer = permission === "viewer";
  const [initial] = useState(() => (edit ? editableFromBody(edit.initialBody) : { text: "", picked: [] as PickedMention[] }));
  const [text, setText] = useState(initial.text);
  const [picked, setPicked] = useState<PickedMention[]>(initial.picked);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const textRef = useRef(initial.text);

  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [active, setActive] = useState(0);

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");
  const shortcut = isMac ? "⌘+Entrée" : "Ctrl+Entrée";

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  // Edit mode: the area takes focus with the caret at the end (after the menu has released it).
  const editing = edit !== undefined;
  useEffect(() => {
    if (!editing) return;
    const raf = requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(raf);
  }, [editing]);

  const body = useMemo(() => buildBody(text, picked), [text, picked]);
  const length = codePoints(body);
  const tooLong = length > MAX_COMMENT_LENGTH;
  const empty = body.length === 0;

  let disabledReason: string | null = null;
  if (isViewer) disabledReason = t("commentDisabledViewer");
  else if (sending) disabledReason = t("commentDisabledSending");
  else if (empty) disabledReason = t("commentDisabledEmpty");
  else if (tooLong) disabledReason = t("commentTooLong");

  // Hauteur automatique (3 lignes minimum via rows).
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Recherche des membres : anti-rebond, requêtes périmées annulées.
  const open = mention !== null && !isViewer;
  const query = mention?.query ?? "";
  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    setLoadingList(true);
    const timer = setTimeout(() => {
      const url = `/api/databases/${databaseId}/mentionable?q=${encodeURIComponent(query)}&limit=${MENTION_LIMIT}`;
      fetchJson<MentionCandidate[] | { items?: MentionCandidate[] }>(url, { signal: ctl.signal })
        .then((res) => {
          if (ctl.signal.aborted) return;
          setCandidates(Array.isArray(res) ? res : (res.items ?? []));
          setActive(0);
          setLoadingList(false);
        })
        .catch(() => {
          if (ctl.signal.aborted) return;
          setCandidates([]);
          setLoadingList(false);
        });
    }, MENTION_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [open, query, databaseId]);

  const closeList = useCallback(() => {
    setMention(null);
    setCandidates([]);
    setLoadingList(false);
  }, []);

  function refreshMention(value: string, caret: number) {
    const q = activeQuery(value, caret);
    if (!q) {
      if (mention) closeList();
      return;
    }
    setMention(q);
  }

  function pick(c: MentionCandidate) {
    const el = areaRef.current;
    if (!mention || !el) return;
    const caret = el.selectionStart ?? text.length;
    const token = `@${neutralName(c.name)} `;
    const next = text.slice(0, mention.start) + token + text.slice(caret);
    const pos = mention.start + token.length;
    setText(next);
    setPicked((prev) => [...prev, { name: c.name, id: c.id }]);
    closeList();
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  async function submit() {
    if (sendingRef.current || isViewer || empty || tooLong) return;
    sendingRef.current = true;
    const sentText = text;
    setSending(true);
    closeList();
    if (edit) {
      try {
        await edit.onSave(body);
      } catch {
        toast.error(t("commentEditError"));
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
      return;
    }
    try {
      const res = await apiPost<{ comment: { id: string } }>(`/api/databases/${databaseId}/rows/${rowId}/comments`, {
        body,
      });
      const commentId = res.comment.id;
      // Ne vide la zone que si le texte n'a pas changé depuis l'envoi.
      if (textRef.current === sentText) {
        setText("");
        setPicked([]);
      }
      onPublished?.(commentId);
      toast.success(t("commentPublished"), {
        action: {
          label: t("commentUndo"),
          onClick: () => {
            void (onUndo?.(commentId) ?? Promise.resolve()).catch(() => toast.error(t("commentDeleteError")));
          },
        },
      });
    } catch {
      toast.error(t("commentPublishError"));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Composition IME en cours : Entrée, Tab et Échap appartiennent à l'éditeur de méthode de saisie.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
      return;
    }
    if (!open) return;
    if (e.key === "Escape") {
      // Ferme la liste seulement : le panneau de la fiche reste ouvert.
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      closeList();
    } else if (e.key === "ArrowDown" && candidates.length > 0) {
      e.preventDefault();
      setActive((i) => (i + 1) % candidates.length);
    } else if (e.key === "ArrowUp" && candidates.length > 0) {
      e.preventDefault();
      setActive((i) => (i - 1 + candidates.length) % candidates.length);
    } else if ((e.key === "Enter" || e.key === "Tab") && candidates.length > 0) {
      e.preventDefault();
      pick(candidates[active] ?? candidates[0]);
    }
  }

  const showList = open;
  const activeId = showList && candidates.length > 0 ? mentionOptionId(listId, active) : undefined;

  const actionLabel = edit ? t("commentSave") : t("commentAction");
  const button = (
    <Button
      type="button"
      size="sm"
      aria-label={actionLabel}
      disabled={disabledReason !== null}
      onClick={() => void submit()}
    >
      {edit ? <Check /> : <Send />}
      {actionLabel}
    </Button>
  );

  // Edit mode: Escape cancels from anywhere in the editor (area or buttons); the mention list keeps
  // priority because the area stops that Escape before it reaches here. The record panel stays open.
  function onContainerKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!edit || e.key !== "Escape" || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    edit.onCancel();
  }

  return (
    <div className={edit ? "mt-1" : "mb-3"} onKeyDown={onContainerKeyDown}>
      <div className="relative">
        {showList && (
          <MentionList
            id={listId}
            items={candidates}
            activeIndex={active}
            loading={loadingList}
            labels={{ list: t("mentionListLabel"), loading: t("mentionLoading"), empty: t("mentionEmpty") }}
            onPick={pick}
            onHover={setActive}
          />
        )}
        <textarea
          ref={areaRef}
          rows={3}
          value={text}
          readOnly={isViewer}
          aria-readonly={isViewer || undefined}
          aria-label={edit ? t("commentEditLabel") : t("composerLabel")}
          placeholder={t("composerPlaceholder")}
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={activeId}
          className="block min-h-[4.5rem] w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-[0.8125rem] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 read-only:opacity-70"
          onChange={(e) => {
            setText(e.target.value);
            setPicked((prev) => pruneMentions(e.target.value, prev));
            refreshMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={onKeyDown}
          onClick={(e) => refreshMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
          onBlur={() => closeList()}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {isViewer ? t("composerReadOnly") : t(edit ? "commentEditHint" : "composerHint", { shortcut })}
          {" "}
          {length >= COUNTER_THRESHOLD && (
            <span aria-live="polite" className={tooLong ? "text-destructive" : undefined}>
              {t("composerCount", { count: length, max: MAX_COMMENT_LENGTH })}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          {edit && (
            <Tip label={t("commentCancelEdit")} kbd="Esc">
              <Button type="button" size="sm" variant="outline" aria-label={t("commentUndo")} onClick={() => edit.onCancel()}>
                <X />
                {t("commentUndo")}
              </Button>
            </Tip>
          )}
          {disabledReason ? (
            <Tip label={disabledReason}>
              <span tabIndex={0} className="inline-flex rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                {button}
              </span>
            </Tip>
          ) : (
            <Tip label={actionLabel} kbd={shortcut}>
              {button}
            </Tip>
          )}
        </div>
      </div>
    </div>
  );
}

"use client"

import { useEffect, useId, useMemo, useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { FolderNode, FolderUndo } from "@/lib/media/folders"

type Api = { ok: boolean; status: number; body: Record<string, unknown> }

async function call(method: string, url: string, body?: unknown): Promise<Api> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const parsed: unknown = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body: (parsed ?? {}) as Record<string, unknown> }
}

const errorOf = (r: Api, fallback: string) => (typeof r.body.error === "string" ? r.body.error : fallback)

type CommonProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Appelé après toute écriture réussie (mutation ou annulation). */
  onDone: () => void
}

function useUndoToast(onDone: () => void) {
  const t = useTranslations("library")
  return (message: string, undo: () => Promise<Api>) =>
    toast.success(message, {
      action: {
        label: t("actions.undo"),
        onClick: () => {
          void undo().then((r) => {
            if (r.ok) toast.success(t("folders.toasts.undone"))
            else toast.error(errorOf(r, t("folders.toasts.undoFailed")))
            onDone()
          })
        },
      },
    })
}

function FormShell({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  destructive,
  onSubmit,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  submitLabel: string
  destructive?: boolean
  onSubmit: () => Promise<void>
  children?: React.ReactNode
}) {
  const t = useTranslations("library.folders")
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await onSubmit()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function NameField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (v: string) => void
  error: string | null
}) {
  const t = useTranslations("library.folders")
  const id = useId()
  const errId = `${id}-err`
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{t("nameLabel")}</Label>
      <Input
        id={id}
        value={value}
        autoFocus
        maxLength={200}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <p id={errId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  onDone,
  parentId = null,
}: CommonProps & { parentId?: string | null }) {
  const t = useTranslations("library.folders")
  const undoToast = useUndoToast(onDone)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setName("")
      setError(null)
    }
  }, [open])

  return (
    <FormShell
      open={open}
      onOpenChange={onOpenChange}
      title={t("createTitle")}
      submitLabel={t("create")}
      onSubmit={async () => {
        const clean = name.trim()
        if (!clean) return setError(t("nameRequired"))
        const r = await call("POST", "/api/media/folders", { name: clean, parentId })
        if (!r.ok) return setError(errorOf(r, t("failed")))
        const folder = r.body.folder as FolderNode
        onOpenChange(false)
        onDone()
        undoToast(t("toasts.created", { name: folder.name }), () =>
          call("DELETE", `/api/media/folders/${folder.id}`),
        )
      }}
    >
      <NameField value={name} onChange={setName} error={error} />
    </FormShell>
  )
}

export function RenameFolderDialog({
  open,
  onOpenChange,
  onDone,
  folder,
}: CommonProps & { folder: FolderNode }) {
  const t = useTranslations("library.folders")
  const undoToast = useUndoToast(onDone)
  const [name, setName] = useState(folder.name)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setName(folder.name)
      setError(null)
    }
  }, [open, folder.name])

  return (
    <FormShell
      open={open}
      onOpenChange={onOpenChange}
      title={t("renameTitle")}
      submitLabel={t("rename")}
      onSubmit={async () => {
        const clean = name.trim()
        if (!clean) return setError(t("nameRequired"))
        const r = await call("PATCH", `/api/media/folders/${folder.id}`, { name: clean })
        if (!r.ok) return setError(errorOf(r, t("failed")))
        onOpenChange(false)
        onDone()
        undoToast(t("toasts.renamed", { name: clean }), () =>
          call("PATCH", `/api/media/folders/${folder.id}`, { name: folder.name }),
        )
      }}
    >
      <NameField value={name} onChange={setName} error={error} />
    </FormShell>
  )
}

function descendantIds(folders: FolderNode[], id: string): Set<string> {
  const out = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id)
        grew = true
      }
    }
  }
  return out
}

export function MoveFolderDialog({
  open,
  onOpenChange,
  onDone,
  folder,
  folders,
}: CommonProps & { folder: FolderNode; folders: FolderNode[] }) {
  const t = useTranslations("library.folders")
  const undoToast = useUndoToast(onDone)
  const selectId = useId()
  const [parentId, setParentId] = useState<string>(folder.parentId ?? "")
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setParentId(folder.parentId ?? "")
      setError(null)
    }
  }, [open, folder.parentId])
  const options = useMemo(() => {
    const banned = descendantIds(folders, folder.id)
    return folders.filter((f) => !banned.has(f.id))
  }, [folders, folder.id])

  return (
    <FormShell
      open={open}
      onOpenChange={onOpenChange}
      title={t("moveTitle")}
      submitLabel={t("move")}
      onSubmit={async () => {
        const target = parentId || null
        const r = await call("PATCH", `/api/media/folders/${folder.id}`, { parentId: target })
        if (!r.ok) return setError(errorOf(r, t("failed")))
        onOpenChange(false)
        onDone()
        undoToast(t("toasts.moved", { name: folder.name }), () =>
          call("PATCH", `/api/media/folders/${folder.id}`, { parentId: folder.parentId }),
        )
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={selectId}>{t("parentLabel")}</Label>
        <select
          id={selectId}
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">{t("root")}</option>
          {options.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </FormShell>
  )
}

export function DeleteFolderDialog({
  open,
  onOpenChange,
  onDone,
  folder,
}: CommonProps & { folder: FolderNode }) {
  const t = useTranslations("library.folders")
  const undoToast = useUndoToast(onDone)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) setError(null)
  }, [open])

  return (
    <FormShell
      open={open}
      onOpenChange={onOpenChange}
      title={t("deleteTitle")}
      description={t("deleteBody", { name: folder.name })}
      submitLabel={t("delete")}
      destructive
      onSubmit={async () => {
        const r = await call("DELETE", `/api/media/folders/${folder.id}`)
        if (!r.ok) return setError(errorOf(r, t("failed")))
        const undo = r.body.undo as FolderUndo
        onOpenChange(false)
        onDone()
        undoToast(t("toasts.deleted", { name: folder.name }), () =>
          call("POST", "/api/media/folders/restore", { undo }),
        )
      }}
    >
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </FormShell>
  )
}

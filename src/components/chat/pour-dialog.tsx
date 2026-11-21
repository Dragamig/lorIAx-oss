"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface PourDialogProps {
  messageId: string | null;
  documentId: string | null;
  onClose: () => void;
  onPoured: (tiptapNode: object) => void;
}

export function PourDialog({ messageId, documentId, onClose, onPoured }: PourDialogProps) {
  const t = useTranslations("chat");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!messageId || !documentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/messages/${messageId}/pour`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? t("pour.serverError"));
        return;
      }
      const { tiptapNode } = await res.json();
      onPoured(tiptapNode);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!messageId} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pour.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("pour.description")}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>{t("pour.cancel")}</Button>
          <Button onClick={handleConfirm} disabled={loading || !documentId}>
            {loading ? t("pour.confirming") : t("pour.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

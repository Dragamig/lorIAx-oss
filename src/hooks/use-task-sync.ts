"use client";
import { useCallback, useRef } from "react";
import type { Editor } from "@tiptap/core";

export function useTaskSync(documentId: string | undefined) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback(
    (editor: Editor) => {
      if (!documentId) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        const content = editor.getJSON();
        fetch("/api/tasks/sync-document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId, content }),
        }).then((res) => {
          if (!res.ok) {
            console.error("Sync failed:", res.status);
          }
        }).catch((err) => {
          console.error("Sync error:", err);
        });
      }, 2000);
    },
    [documentId]
  );
}

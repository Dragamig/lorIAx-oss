"use client";

import { useState, useEffect } from "react";
import { History, Loader2, CheckCircle, XCircle, Clock } from "lucide-react";

interface EmailLogEntry {
  id: string;
  to: string;
  subject: string;
  template: string;
  status: "sent" | "failed";
  error?: string;
  sentAt: string;
}

export default function EmailsLogsPage() {
  const [logs, setLogs] = useState<EmailLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/emails/logs");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && Array.isArray(data)) setLogs(data);
        }
      } catch {
        // Silently fail — logs are informational
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6 pb-24">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Historique</h2>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <p className="text-sm text-muted-foreground">
          Suivi des envois récents (statut, destinataire, template).
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12">
          <History className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Aucun email envoyé pour le moment.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            L&apos;historique apparaîtra ici une fois le provider configuré et des emails envoyés.
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Statut</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Destinataire</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Objet</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Modèle</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Date</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    {log.status === "sent" ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">{log.to}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{log.subject}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground">
                      {log.template}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(log.sentAt).toLocaleString("fr-FR")}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

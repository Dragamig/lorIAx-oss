"use client";

import { Mail, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmailTemplate {
  id: string;
  name: string;
  description: string;
  subject: string;
  variables: string[];
}

const emailTemplates: EmailTemplate[] = [
  {
    id: "password-reset",
    name: "Réinitialisation de mot de passe",
    description: "Envoyé lorsqu'un utilisateur demande un nouveau mot de passe.",
    subject: "LorIAx — Réinitialisation de mot de passe",
    variables: ["userName", "resetUrl", "expiresInMinutes"],
  },
  {
    id: "invitation",
    name: "Invitation à un espace",
    description: "Envoyé lorsqu'un membre est invité à rejoindre un espace.",
    subject: "LorIAx — Invitation dans un espace",
    variables: ["inviterName", "spaceName", "acceptUrl"],
  },
  {
    id: "notification",
    name: "Notification d'activité",
    description: "Envoyé pour les mentions, commentaires, réponses et partages.",
    subject: "LorIAx — Nouvelle notification",
    variables: ["userName", "actorName", "type", "documentTitle", "documentUrl", "message"],
  },
];

export default function EmailsTemplatesPage() {
  return (
    <div className="space-y-6 pb-24">
      <div>
        <h2 className="text-lg font-semibold">Courriels types</h2>
        <p className="text-sm text-muted-foreground">
          Templates de courriels utilisés par le système. Ces modèles sont définis dans le code source.
        </p>
      </div>

      <div className="grid gap-4">
        {emailTemplates.map((tpl) => (
          <div
            key={tpl.id}
            className="p-4 rounded-lg border border-border bg-card hover:border-primary/30 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 p-2 rounded-md bg-primary/10">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h4 className="font-medium text-sm">{tpl.name}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{tpl.description}</p>
                  <div className="mt-2">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Objet :</span> {tpl.subject}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {tpl.variables.map((v) => (
                      <span
                        key={v}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground font-mono"
                      >
                        {`{{${v}}}`}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="sm" disabled title="Aperçu (bientôt)">
                <Eye className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

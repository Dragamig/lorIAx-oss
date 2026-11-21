export interface BaseTemplateColumn {
  name: string;
  type:
    | "text"
    | "number"
    | "date"
    | "select"
    | "checkbox"
    | "relation"
    | "image"
    | "formula"
    | "url"
    | "email";
  config?: Record<string, unknown>;
}

export interface BaseTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  columns: BaseTemplateColumn[];
}

export const BASE_TEMPLATES: BaseTemplate[] = [
  {
    id: "crm-contacts",
    name: "CRM — Contacts",
    description: "Carnet de contacts avec entreprise, statut et prochaine action.",
    icon: "👥",
    columns: [
      { name: "Nom", type: "text" },
      { name: "Entreprise", type: "text" },
      { name: "Email", type: "email" },
      {
        name: "Statut",
        type: "select",
        config: {
          options: [
            { label: "Prospect", color: "#94a3b8" },
            { label: "Qualifié", color: "#3b82f6" },
            { label: "Client", color: "#10b981" },
            { label: "Perdu", color: "#ef4444" },
          ],
        },
      },
      { name: "Prochaine action", type: "date" },
      { name: "Notes", type: "text" },
    ],
  },
  {
    id: "project-tasks",
    name: "Projet — Tâches",
    description: "Tâches d'un projet avec priorité, échéance et statut.",
    icon: "✅",
    columns: [
      { name: "Tâche", type: "text" },
      {
        name: "Statut",
        type: "select",
        config: {
          options: [
            { label: "À faire", color: "#94a3b8" },
            { label: "En cours", color: "#3b82f6" },
            { label: "Bloquée", color: "#ef4444" },
            { label: "Terminée", color: "#10b981" },
          ],
        },
      },
      {
        name: "Priorité",
        type: "select",
        config: {
          options: [
            { label: "Basse", color: "#94a3b8" },
            { label: "Normale", color: "#3b82f6" },
            { label: "Haute", color: "#f59e0b" },
            { label: "Urgente", color: "#ef4444" },
          ],
        },
      },
      { name: "Échéance", type: "date" },
      { name: "Terminée", type: "checkbox" },
    ],
  },
  {
    id: "content-calendar",
    name: "Calendrier éditorial",
    description: "Planification de contenus avec canal, date de publication, statut.",
    icon: "📅",
    columns: [
      { name: "Titre", type: "text" },
      {
        name: "Canal",
        type: "select",
        config: {
          options: [
            { label: "Blog", color: "#3b82f6" },
            { label: "Newsletter", color: "#8b5cf6" },
            { label: "LinkedIn", color: "#0ea5e9" },
            { label: "Instagram", color: "#ec4899" },
          ],
        },
      },
      { name: "Publication", type: "date" },
      {
        name: "Statut",
        type: "select",
        config: {
          options: [
            { label: "Idée", color: "#94a3b8" },
            { label: "Rédaction", color: "#f59e0b" },
            { label: "Relecture", color: "#3b82f6" },
            { label: "Publié", color: "#10b981" },
          ],
        },
      },
      { name: "Lien", type: "url" },
    ],
  },
  {
    id: "inventory",
    name: "Inventaire",
    description: "Stock produit avec quantité, prix et seuil d'alerte.",
    icon: "📦",
    columns: [
      { name: "Référence", type: "text" },
      { name: "Désignation", type: "text" },
      { name: "Quantité", type: "number" },
      { name: "Prix unitaire (€)", type: "number" },
      { name: "Seuil d'alerte", type: "number" },
      { name: "Photo", type: "image" },
    ],
  },
  {
    id: "habit-tracker",
    name: "Suivi d'habitudes",
    description: "Habitudes quotidiennes avec date et complétion.",
    icon: "🎯",
    columns: [
      { name: "Habitude", type: "text" },
      { name: "Date", type: "date" },
      { name: "Fait", type: "checkbox" },
      { name: "Note", type: "text" },
    ],
  },
  {
    id: "blank",
    name: "Base vierge",
    description: "Une seule colonne « Nom » — partez de zéro.",
    icon: "✨",
    columns: [{ name: "Nom", type: "text" }],
  },
];

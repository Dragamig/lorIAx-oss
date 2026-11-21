import Papa from "papaparse";

export interface ParsedUser {
  email: string;
  name: string;
  role: string;
}
export interface ParseResult {
  rows: ParsedUser[];
  errors: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Valeurs exactes de userRoleEnum (src/lib/db/schema.ts)
const ALLOWED_ROLES = [
  "super_admin",
  "admin",
  "editor",
  "viewer",
  "facility_manager",
  "automation_manager",
  "template_doc_editor",
  "template_graphic_editor",
];

export function parseUsersCsv(csv: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  const rows: ParsedUser[] = [];
  const errors: string[] = [];
  parsed.data.forEach((raw, i) => {
    const email = (raw.email || "").trim().toLowerCase();
    const name = (raw.name || "").trim();
    let role = (raw.role || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      errors.push(`Ligne ${i + 2} : email invalide « ${raw.email ?? ""} »`);
      return;
    }
    if (!role) role = "editor";
    if (!ALLOWED_ROLES.includes(role)) {
      errors.push(`Ligne ${i + 2} : rôle inconnu « ${role} »`);
      return;
    }
    rows.push({ email, name: name || email, role });
  });
  return { rows, errors };
}

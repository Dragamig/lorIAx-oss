import type { PermissionLevel } from "@/types";
import type { DbColumnType } from "../column-types";

export interface TemplateColumn {
  key: string;
  name: string;
  type: DbColumnType;
  options?: string[];
  config?: Record<string, unknown>;
}

/** Vue posée sur une base créée ; `config` reçoit les ids des colonnes créées, par `key`. La première est la vue par défaut. */
export interface TemplateView {
  name: string;
  type: "grid" | "kanban";
  config: (columns: Record<string, string>) => Record<string, unknown>;
}

export interface TemplateDatabase {
  key: string;
  name: string;
  columns: TemplateColumn[];
  views?: TemplateView[];
}

export interface TemplateSpec {
  space: { mode: "create"; name: string } | { mode: "existing"; spaceId: string };
  databases: TemplateDatabase[];
}

export interface AppliedTemplate {
  spaceId: string;
  spaceCreated: boolean;
  databases: Record<string, { id: string; columns: Record<string, string> }>;
}

export type TemplateError =
  | { code: "not_found" }
  | { code: "forbidden" }
  | { code: "relation_conflict" }
  | { code: "name_collision"; key: string };

export class TemplateFailure extends Error {
  constructor(public readonly error: TemplateError) {
    super(`template_${error.code}`);
    this.name = "TemplateFailure";
  }
}

export interface TemplateContext {
  orgId: string;
  userId: string;
  permissionOf: (userId: string, spaceId: string) => Promise<PermissionLevel | null>;
}

import { z } from "zod";

export const MAX_COLUMNS = 30;
export const MAX_ROWS = 50;
export const MAX_OUTLINE = 30;
export const MAX_SLIDES = 12;
export const MAX_BULLETS = 8;
export const MAX_BODY_MARKDOWN = 20_000;

const common = {
  spaceId: z.string().uuid(),
  title: z.string().min(1).max(200),
  parentId: z.string().uuid().optional(),
};

const columnSchema = z
  .object({
    name: z.string().min(1).max(60),
    type: z.enum(["text", "number", "date"]).optional(),
  })
  .strict();

const outlineItemSchema = z
  .object({
    heading: z.string().min(1).max(200),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    summary: z.string().max(1000).optional(),
  })
  .strict();

const slideSchema = z
  .object({
    title: z.string().min(1).max(200),
    bullets: z.array(z.string().min(1).max(500)).max(MAX_BULLETS).optional(),
    notes: z.string().max(2000).optional(),
    layout: z.enum(["cover", "content", "closing"]).optional(),
  })
  .strict();

export const spreadsheetProposalSchema = z
  .object({
    ...common,
    columns: z.array(columnSchema).min(1).max(MAX_COLUMNS),
    rows: z.array(z.array(z.string().max(1000))).max(MAX_ROWS).optional(),
    sheetTitle: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    v.rows?.forEach((row, i) => {
      if (row.length !== v.columns.length) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", i],
          message: "La ligne doit avoir autant de cellules que de colonnes",
        });
      }
    });
  });

export const documentProposalSchema = z
  .object({
    ...common,
    outline: z.array(outlineItemSchema).min(1).max(MAX_OUTLINE),
    bodyMarkdown: z.string().max(MAX_BODY_MARKDOWN).optional(),
  })
  .strict();

export const presentationProposalSchema = z
  .object({
    ...common,
    slides: z.array(slideSchema).min(1).max(MAX_SLIDES),
    templateId: z.string().min(1).max(100).optional(),
  })
  .strict();

export const creationOverridesSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    spaceId: z.string().uuid().optional(),
    columns: z.array(columnSchema).min(1).max(MAX_COLUMNS).optional(),
    outline: z.array(outlineItemSchema).min(1).max(MAX_OUTLINE).optional(),
    slideTitles: z.array(z.string().min(1).max(200)).max(MAX_SLIDES).optional(),
  })
  .strict();

export type SpreadsheetProposal = z.infer<typeof spreadsheetProposalSchema>;
export type DocumentProposal = z.infer<typeof documentProposalSchema>;
export type PresentationProposal = z.infer<typeof presentationProposalSchema>;
export type CreationOverrides = z.infer<typeof creationOverridesSchema>;

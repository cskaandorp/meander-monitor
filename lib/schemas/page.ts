import { z } from "zod";

export const pageSchema = z.object({
  title: z.string().min(1, "Title is required"),
  slug: z.string().min(1, "Slug is required"),
  is_visible: z.boolean().default(false),
  intro_text: z.record(z.string(), z.unknown()).nullable().optional(),
  banner_url: z.string().nullable().optional(),
  banner_position_x: z.number().int().default(50),
  banner_position_y: z.number().int().default(50),
});

export const contentBlockSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["richtext", "media"]).default("richtext"),
  title: z.string().nullable().optional(),
  content: z.record(z.string(), z.unknown()).default({}),
  sort_order: z.number().int(),
  timestamp: z.string().nullable().optional(),
});

export const pageImageSchema = z.object({
  id: z.string().uuid(),
  image_url: z.string(),
  position_x: z.number().int().default(50),
  position_y: z.number().int().default(50),
  aspect_ratio: z.string().default("4/3"),
  sort_order: z.number().int(),
});

export type PageFormData = z.infer<typeof pageSchema>;
export type ContentBlockFormData = z.infer<typeof contentBlockSchema>;
export type PageImageFormData = z.infer<typeof pageImageSchema>;

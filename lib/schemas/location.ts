import { z } from "zod";

/** Mirrors the locations_slug_format CHECK constraint in the database. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const locationSchema = z.object({
  slug: z
    .string()
    .min(1, "Slug is required")
    .regex(SLUG_PATTERN, "Lowercase letters, numbers and single hyphens only"),
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  // Nullable rather than defaulted: "we haven't recorded the coordinates" is a
  // real state, and 0,0 is a real place in the Atlantic.
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  is_active: z.boolean().default(true),
});

export type LocationFormData = z.infer<typeof locationSchema>;

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { locationSchema, type LocationFormData } from "@/lib/schemas/location";

export async function createLocation(data: LocationFormData) {
  const parsed = locationSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("locations").insert(parsed.data);

  if (error) {
    // 23505 = unique_violation. The slug is in printed QR codes, so a clash is
    // worth naming precisely rather than surfacing a Postgres error.
    if (error.code === "23505") {
      return { error: `The slug "${parsed.data.slug}" is already in use` };
    }
    return { error: error.message };
  }

  revalidatePath("/admin/locations");
  revalidatePath("/submit");
  return { success: true };
}

export async function updateLocation(id: string, data: LocationFormData) {
  const parsed = locationSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("locations").update(parsed.data).eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return { error: `The slug "${parsed.data.slug}" is already in use` };
    }
    return { error: error.message };
  }

  revalidatePath("/admin/locations");
  revalidatePath("/submit");
  revalidatePath(`/submit/${parsed.data.slug}`);
  return { success: true };
}

export async function toggleLocationActive(id: string, is_active: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("locations").update({ is_active }).eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/admin/locations");
  revalidatePath("/submit");
  return { success: true };
}

export async function deleteLocation(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("locations").delete().eq("id", id);

  if (error) {
    // 23503 = foreign_key_violation, from submissions.location_id's ON DELETE
    // RESTRICT. The location is what gives those recordings their meaning, so
    // this is the database refusing to orphan them, not a bug.
    if (error.code === "23503") {
      return {
        error:
          "This location has recordings and cannot be deleted. Deactivate it instead — its QR code will stop accepting new videos.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/admin/locations");
  revalidatePath("/submit");
  return { success: true };
}

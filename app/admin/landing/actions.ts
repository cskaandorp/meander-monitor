"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { deleteMedia } from "@/lib/supabase/storage";
import type { LandingItemType } from "@/lib/types/database";

export async function saveIntro(title: string, text: string) {
  const supabase = await createClient();

  const { error: titleError } = await supabase
    .from("site_settings")
    .update({ value: title })
    .eq("key", "intro_title");

  if (titleError) return { error: titleError.message };

  const { error: textError } = await supabase
    .from("site_settings")
    .update({ value: text })
    .eq("key", "intro_text");

  if (textError) return { error: textError.message };

  revalidatePath("/");
  revalidatePath("/admin/landing");
  return { success: true };
}

export async function saveLandingItems(
  items: {
    id: string;
    type: LandingItemType;
    title: string | null;
    image_url: string;
    link_url: string | null;
    image_position_x: number;
    image_position_y: number;
    sort_order: number;
  }[]
) {
  const supabase = await createClient();

  // Items are replaced wholesale below, so drop the files for any image the
  // editor removed before its row disappears.
  const { data: oldItems } = await supabase.from("landing_items").select("image_url");

  if (oldItems) {
    const newImageUrls = new Set(items.map((i) => i.image_url));
    await Promise.all(
      oldItems
        .filter((old) => old.image_url && !newImageUrls.has(old.image_url))
        .map((old) => deleteMedia(old.image_url))
    );
  }

  const { error: deleteError } = await supabase
    .from("landing_items")
    .delete()
    .gte("sort_order", 0); // matches all rows

  if (deleteError) return { error: deleteError.message };

  if (items.length > 0) {
    const { error: insertError } = await supabase.from("landing_items").insert(items);

    if (insertError) return { error: insertError.message };
  }

  revalidatePath("/");
  revalidatePath("/admin/landing");
  return { success: true };
}

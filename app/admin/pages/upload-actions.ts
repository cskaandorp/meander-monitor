"use server";

import { deleteMedia } from "@/lib/supabase/storage";

export async function removePageMedia(url: string) {
  return deleteMedia(url);
}

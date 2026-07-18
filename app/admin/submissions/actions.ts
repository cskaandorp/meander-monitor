"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Delete submissions completely — the stored files AND the rows.
 *
 * A database row and a storage file are separate things: dropping the row alone
 * leaves the video on disk forever (the orphan problem). So we remove, per
 * submission: every result artifact under results/<user>/<id>/, the raw clip in
 * the submissions bucket, and only then the row.
 *
 * Runs as the admin's own session — the storage RLS policies already grant
 * is_admin full read/delete on both buckets, so no service key is needed.
 */
export async function deleteSubmissions(ids: string[]) {
  if (!ids.length) return { success: true, deleted: 0 };

  const supabase = await createClient();

  // Fetch the paths server-side rather than trusting the client with them.
  const { data: rows, error: fetchError } = await supabase
    .from("submissions")
    .select("id, user_id, storage_path")
    .in("id", ids);

  if (fetchError) return { error: fetchError.message };

  for (const row of rows ?? []) {
    // Result artifacts live under results/<user_id>/<submission_id>/… — list the
    // folder and remove whatever's there (image now, maybe more later).
    const prefix = `${row.user_id}/${row.id}`;
    const { data: artifacts } = await supabase.storage.from("results").list(prefix);
    if (artifacts?.length) {
      await supabase.storage
        .from("results")
        .remove(artifacts.map((a) => `${prefix}/${a.name}`));
    }

    // The raw upload.
    if (row.storage_path) {
      await supabase.storage.from("submissions").remove([row.storage_path]);
    }
  }

  const { error: deleteError } = await supabase.from("submissions").delete().in("id", ids);
  if (deleteError) return { error: deleteError.message };

  revalidatePath("/admin/submissions");
  return { success: true, deleted: rows?.length ?? 0 };
}

import { createClient } from "@/lib/supabase/server";
import { SubmissionsClient, type SubmissionRow } from "./submissions-client";

export default async function SubmissionsAdminPage() {
  const supabase = await createClient();

  // Newest first, capped. Pagination is a future concern once volume grows.
  const { data } = await supabase
    .from("submissions")
    .select("id, user_id, storage_path, result_path, result, status, error, created_at, locations(slug, name)")
    .order("created_at", { ascending: false })
    .limit(1000);

  return <SubmissionsClient rows={(data as unknown as SubmissionRow[]) ?? []} />;
}

import { createClient } from "@/lib/supabase/server";
import { PagesList } from "./pages-list";
import type { Page } from "@/lib/types/database";

export default async function PagesListPage() {
  const supabase = await createClient();
  const { data: pages } = await supabase
    .from("pages")
    .select("*")
    .order("menu_order", { ascending: true, nullsFirst: false });

  return <PagesList pages={(pages as Page[]) ?? []} />;
}

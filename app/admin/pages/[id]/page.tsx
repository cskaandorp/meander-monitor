import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageForm } from "../page-form";
import type { Page, ContentBlock, PageImage } from "@/lib/types/database";

export default async function EditPagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: page } = await supabase
    .from("pages")
    .select("*")
    .eq("id", id)
    .single();

  if (!page) {
    notFound();
  }

  const [{ data: blocks }, { data: images }] = await Promise.all([
    supabase
      .from("blocks")
      .select("*")
      .eq("page_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("page_images")
      .select("*")
      .eq("page_id", id)
      .order("sort_order", { ascending: true }),
  ]);

  return (
    <PageForm
      page={page as Page}
      blocks={(blocks as ContentBlock[]) ?? []}
      images={(images as PageImage[]) ?? []}
    />
  );
}

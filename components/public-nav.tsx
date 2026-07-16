import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DesktopNav } from "./desktop-nav";
import { MobileNav } from "./mobile-nav";
import type { Page } from "@/lib/types/database";

export async function PublicNav() {
  const supabase = await createClient();

  const { data: pages } = await supabase
    .from("pages")
    .select("id, title, slug, menu_order")
    .not("menu_order", "is", null)
    .eq("is_visible", true)
    .order("menu_order", { ascending: true });

  const navPages = (pages as Pick<Page, "id" | "title" | "slug" | "menu_order">[]) ?? [];

  return (
    <header className="h-20 flex items-end justify-between pl-10 pr-10 relative z-10">
      <Link href="/" className="mb-3 font-heading text-xl font-bold">
        Meander Monitor
      </Link>
      <DesktopNav pages={navPages} />
      <MobileNav pages={navPages} />
    </header>
  );
}

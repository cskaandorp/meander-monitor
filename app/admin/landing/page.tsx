import { createClient } from "@/lib/supabase/server";
import { LandingForm } from "./landing-form";
import type { LandingItem } from "@/lib/types/database";

export default async function LandingAdminPage() {
  const supabase = await createClient();

  const [{ data: titleSetting }, { data: textSetting }, { data: items }] = await Promise.all([
    supabase.from("site_settings").select("value").eq("key", "intro_title").single(),
    supabase.from("site_settings").select("value").eq("key", "intro_text").single(),
    supabase.from("landing_items").select("*").order("sort_order"),
  ]);

  const allItems = (items as LandingItem[]) ?? [];

  return (
    <LandingForm
      introTitle={titleSetting?.value ?? ""}
      introText={textSetting?.value ?? ""}
      initialSlides={allItems.filter((i) => i.type === "slide")}
      initialTiles={allItems.filter((i) => i.type === "tile")}
    />
  );
}

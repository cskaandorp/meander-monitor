import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Slideshow } from "./slideshow";
import { getImageUrl } from "@/lib/supabase/image-url";
import type { LandingItem } from "@/lib/types/database";

export default async function Home() {
  const supabase = await createClient();

  const [{ data: titleSetting }, { data: textSetting }, { data: items }] = await Promise.all([
    supabase.from("site_settings").select("value").eq("key", "intro_title").single(),
    supabase.from("site_settings").select("value").eq("key", "intro_text").single(),
    supabase.from("landing_items").select("*").order("sort_order"),
  ]);

  const introTitle = titleSetting?.value ?? "";
  const introText = textSetting?.value ?? "";
  const allItems = (items as LandingItem[]) ?? [];
  const slides = allItems.filter((i) => i.type === "slide");
  const tiles = allItems.filter((i) => i.type === "tile");

  return (
    <div>
      {/* Slideshow */}
      {slides.length > 0 && (
        <Slideshow
          slides={slides.map((s) => ({
            src: getImageUrl(s.image_url, { width: 1400, quality: 80 }),
            title: s.title,
            positionX: s.image_position_x ?? 50,
            positionY: s.image_position_y ?? 50,
          }))}
        />
      )}

      {/* Intro */}
      {(introTitle || introText) && (
        <section className="container mx-auto px-4 py-12 text-center max-w-4xl">
          {introTitle && (
            <h1 className="text-4xl font-bold mb-4">{introTitle}</h1>
          )}
          {introText && (
            <p className="text-lg text-muted-foreground leading-relaxed">
              {introText}
            </p>
          )}
        </section>
      )}

      {/* Tiles */}
      {tiles.length > 0 && (
        <section className="container mx-auto px-4 pb-16">
          <div className="flex flex-wrap justify-center gap-8">
            {tiles.map((tile) => {
              const inner = (
                <div className="group relative aspect-[5/3] overflow-hidden rounded-lg">
                  <img
                    src={getImageUrl(tile.image_url, { width: 600, quality: 80 })}
                    alt={tile.title ?? ""}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    style={{ objectPosition: `${tile.image_position_x ?? 50}% ${tile.image_position_y ?? 50}%` }}
                  />
                  {tile.title && (
                    <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent" />
                  )}
                  {tile.title && (
                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      <h3 className="text-lg font-semibold text-white">
                        {tile.title}
                      </h3>
                    </div>
                  )}
                </div>
              );

              const wrapper = "w-full sm:w-[calc(50%-1rem)] lg:w-[calc(33.333%-1.34rem)]";
              return tile.link_url ? (
                <Link key={tile.id} href={tile.link_url} className={wrapper}>
                  {inner}
                </Link>
              ) : (
                <div key={tile.id} className={wrapper}>{inner}</div>
              );
            })}
          </div>
        </section>
      )}

    </div>
  );
}

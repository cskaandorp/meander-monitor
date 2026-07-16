import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ContentBlockRenderer } from "@/components/content-block-renderer";
import { RichtextRenderer } from "@/components/richtext-renderer";
import { getImageUrl } from "@/lib/supabase/image-url";
import { BannerImage } from "@/components/banner-image";
import type { Metadata } from "next";
import type { Page, ContentBlock, PageImage } from "@/lib/types/database";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: page } = await supabase
    .from("pages")
    .select("title")
    .eq("slug", slug)
    .eq("is_visible", true)
    .single();

  if (!page) {
    return { title: "Not Found" };
  }

  return { title: page.title || undefined };
}

export default async function DynamicPage({ params }: PageProps) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: page } = await supabase
    .from("pages")
    .select("*")
    .eq("slug", slug)
    .eq("is_visible", true)
    .single();

  if (!page) {
    notFound();
  }

  const typedPage = page as Page;

  const [{ data: blocks }, { data: images }] = await Promise.all([
    supabase
      .from("blocks")
      .select("*")
      .eq("page_id", typedPage.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("page_images")
      .select("*")
      .eq("page_id", typedPage.id)
      .order("sort_order", { ascending: true }),
  ]);

  const typedBlocks = (blocks as ContentBlock[]) ?? [];
  const typedImages = (images as PageImage[]) ?? [];

  const introText = typedPage.intro_text as Record<string, unknown> | null;
  const hasIntro = introText && Object.keys(introText).length > 0;
  const hasImages = typedImages.length > 0;

  return (
    <article>
      {typedPage.banner_url && (
        <BannerImage
          src={getImageUrl(typedPage.banner_url, { width: 2800, quality: 85 })}
          positionX={typedPage.banner_position_x ?? 50}
          positionY={typedPage.banner_position_y ?? 50}
        />
      )}
      <div className="container mx-auto max-w-5xl px-4 py-12">
        {typedPage.title && (
          <h1 className="mb-8 text-4xl font-bold">{typedPage.title}</h1>
        )}

        {hasIntro && (
          <div className="mb-8">
            <RichtextRenderer content={introText!} />
          </div>
        )}

        {(typedBlocks.length > 0 || hasImages) && (
          <div className="grid gap-8 md:grid-cols-2">
            {typedBlocks.length > 0 && (
              <div className="space-y-8">
                {typedBlocks.map((block) => (
                  <ContentBlockRenderer key={block.id} block={block} />
                ))}
              </div>
            )}
            {hasImages && (
              <div className="block-gap">
                {typedImages.map((img) => (
                  <img
                    key={img.id}
                    src={getImageUrl(img.image_url, { width: 600, quality: 80 })}
                    alt=""
                    className="w-full rounded-lg object-cover"
                    style={{
                      aspectRatio: img.aspect_ratio,
                      objectPosition: `${img.position_x}% ${img.position_y}%`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

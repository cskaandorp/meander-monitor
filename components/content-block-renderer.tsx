import { RichtextRenderer } from "./richtext-renderer";
import { getImageUrl } from "@/lib/supabase/image-url";
import type { ContentBlock } from "@/lib/types/database";

function BlockTimestamp({ timestamp }: { timestamp: string }) {
  const date = new Date(timestamp);
  const formatted = date.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <time dateTime={timestamp} className="block text-sm text-muted-foreground mb-2">
      {formatted}
    </time>
  );
}

function MediaBlock({ content }: { content: Record<string, unknown> }) {
  const url = content.url as string | undefined;
  const mediaType = (content.media_type as string | undefined) ?? "image";
  const thumbnailUrl = content.thumbnail_url as string | undefined;
  const text = content.text as Record<string, unknown> | undefined;
  const hasCaption = text && Object.keys(text).length > 0;

  if (!url) return null;

  return (
    <div className="block-gap">
      {mediaType === "video" ? (
        <video
          src={url}
          poster={thumbnailUrl}
          controls
          playsInline
          preload="metadata"
          className="w-full rounded-lg"
        />
      ) : (
        <img
          src={getImageUrl(url, { width: 1200, quality: 80 })}
          alt=""
          className="w-full rounded-lg"
        />
      )}
      {hasCaption && (
        <div className="text-sm text-muted-foreground">
          <RichtextRenderer content={text!} />
        </div>
      )}
    </div>
  );
}

function BlockContent({ block }: { block: ContentBlock }) {
  const content = block.content as Record<string, unknown>;

  if (block.type === "media") {
    return <MediaBlock content={content} />;
  }
  if (block.type !== "richtext") return null;
  return <RichtextRenderer content={content} />;
}

export function ContentBlockRenderer({ block }: { block: ContentBlock }) {
  return (
    <section>
      {block.title && (
        <h2
          id={block.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}
          className="text-2xl font-bold text-foreground mb-3"
        >
          {block.title}
        </h2>
      )}
      {block.timestamp && <BlockTimestamp timestamp={block.timestamp} />}
      <BlockContent block={block} />
    </section>
  );
}

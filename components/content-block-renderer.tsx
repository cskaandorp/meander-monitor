import { RichtextRenderer } from "./richtext-renderer";
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

export function ContentBlockRenderer({ block }: { block: ContentBlock }) {
  if (block.type !== "richtext") return null;

  return (
    <section>
      {block.title && (
        <h2
          id={block.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}
          className="text-2xl font-bold text-black mb-3"
        >
          {block.title}
        </h2>
      )}
      {block.timestamp && <BlockTimestamp timestamp={block.timestamp} />}
      <RichtextRenderer content={block.content as Record<string, unknown>} />
    </section>
  );
}

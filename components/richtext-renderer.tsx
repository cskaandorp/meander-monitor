import { generateHTML } from "@tiptap/html/server";
import StarterKit from "@tiptap/starter-kit";
import LinkExtension from "@tiptap/extension-link";
import ImageExtension from "@tiptap/extension-image";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import type { JSONContent } from "@tiptap/core";

interface RichtextRendererProps {
  content: Record<string, unknown>;
}

export function RichtextRenderer({ content }: RichtextRendererProps) {
  if (!content || Object.keys(content).length === 0) {
    return null;
  }

  const html = generateHTML(content as JSONContent, [
    StarterKit.configure({
      link: false,
    }),
    LinkExtension.extend({
      renderHTML({ HTMLAttributes }) {
        const { target, rel, ...rest } = HTMLAttributes;
        return ["a", rest, 0];
      },
    }).configure({
      openOnClick: false,
      autolink: false,
      isAllowedUri: () => true,
      defaultProtocol: "https",
    }),
    ImageExtension,
    Table.configure({
      HTMLAttributes: { class: "rt-table" },
    }),
    TableRow,
    TableCell.configure({
      HTMLAttributes: { class: "rt-cell" },
    }),
    TableHeader.configure({
      HTMLAttributes: { class: "rt-header" },
    }),
  ]);

  return (
    <div
      className="prose max-w-none text-foreground/80"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

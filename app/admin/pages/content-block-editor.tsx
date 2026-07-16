"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import dynamic from "next/dynamic";

const TiptapEditor = dynamic(
  () => import("@/components/tiptap-editor").then((m) => m.TiptapEditor),
  { ssr: false, loading: () => <div className="min-h-[200px] rounded-md border p-4" /> }
);

interface ContentBlockEditorProps {
  id: string;
  title: string | null;
  content: Record<string, unknown>;
  timestamp: string | null;
  onContentChange: (content: Record<string, unknown>) => void;
  onTitleChange: (title: string | null) => void;
  onTimestampChange: (timestamp: string | null) => void;
  onDelete: () => void;
}

export function ContentBlockEditor({
  id,
  title,
  content,
  timestamp,
  onContentChange,
  onTitleChange,
  onTimestampChange,
  onDelete,
}: ContentBlockEditorProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="rounded-md border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <button
          type="button"
          className="cursor-grab text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="flex items-center gap-1 text-sm font-medium hover:text-foreground"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
          {title || "Richtext"}
        </button>
        <div className="ml-auto">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => {
              if (window.confirm("Are you sure you want to delete this block?")) {
                onDelete();
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {!collapsed && (
        <div className="space-y-4 p-3">
          <div className="space-y-2">
            <Label>Title (optional)</Label>
            <Input
              value={title ?? ""}
              onChange={(e) => onTitleChange(e.target.value || null)}
              placeholder="Subtitle for this block"
            />
          </div>
          <div className="space-y-2">
            <Label>Date/time (optional)</Label>
            <Input
              type="datetime-local"
              value={timestamp ? new Date(timestamp).toISOString().slice(0, 16) : ""}
              onChange={(e) =>
                onTimestampChange(
                  e.target.value ? new Date(e.target.value).toISOString() : null
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Content</Label>
            <TiptapEditor content={content} onChange={onContentChange} />
          </div>
        </div>
      )}
    </div>
  );
}

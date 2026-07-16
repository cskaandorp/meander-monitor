"use client";

import { useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Upload, Move } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFileUpload } from "@/lib/hooks/use-file-upload";
import { Progress } from "@/components/ui/progress";
import { getImageUrl } from "@/lib/supabase/image-url";
import { ImagePositionPicker } from "@/components/image-position-picker";
import { toast } from "sonner";

interface ItemState {
  id: string;
  title: string | null;
  image_url: string;
  link_url: string | null;
  image_position_x: number;
  image_position_y: number;
}

interface LandingItemEditorProps {
  item: ItemState;
  showLink: boolean;
  onUpdate: (update: Partial<ItemState>) => void;
  onDelete: () => void;
}

export function LandingItemEditor({ item, showLink, onUpdate, onDelete }: LandingItemEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { phase, progress, error, upload } = useFileUpload("image");
  const [showPicker, setShowPicker] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = await upload(file);
    if (result) {
      onUpdate({ image_url: result.url, image_position_x: 50, image_position_y: 50 });
      toast.success("Image uploaded");
    } else if (error) {
      toast.error(error);
    }

    if (inputRef.current) inputRef.current.value = "";
  }

  const busy = phase === "uploading" || phase === "processing";
  const hasNonCenterPosition = item.image_position_x !== 50 || item.image_position_y !== 50;

  return (
    <div ref={setNodeRef} style={style} className="rounded-md border bg-card p-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="mt-1 cursor-grab text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="shrink-0">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUpload}
          />
          {item.image_url ? (
            <div className="space-y-1">
              <button
                type="button"
                className="block"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
              >
                <img
                  src={getImageUrl(item.image_url, { width: 192, height: 128, quality: 70 })}
                  alt=""
                  className="h-16 w-24 rounded border object-cover"
                  style={{ objectPosition: `${item.image_position_x}% ${item.image_position_y}%` }}
                />
              </button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs w-24 px-0"
                onClick={() => setShowPicker(!showPicker)}
              >
                <Move className="h-3 w-3 mr-1" />
                {hasNonCenterPosition ? `${item.image_position_x}/${item.image_position_y}` : "Position"}
              </Button>
            </div>
          ) : busy ? (
            <div className="flex h-16 w-24 items-center justify-center rounded border">
              {phase === "processing" ? (
                <Progress indeterminate className="w-16" />
              ) : (
                <Progress value={progress} className="w-16" />
              )}
            </div>
          ) : (
            <button
              type="button"
              className="flex h-16 w-24 items-center justify-center rounded border border-dashed text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <Input
            value={item.title ?? ""}
            onChange={(e) => onUpdate({ title: e.target.value || null })}
            placeholder="Title (optional)"
            className="h-8 text-sm"
          />
          {showLink && (
            <Input
              value={item.link_url ?? ""}
              onChange={(e) => onUpdate({ link_url: e.target.value || null })}
              placeholder="Link URL (e.g. /page-slug)"
              className="h-8 text-sm"
            />
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {showPicker && item.image_url && (
        <div className="mt-3 ml-7 max-w-sm">
          <p className="text-xs text-muted-foreground mb-1">
            Click or drag to set the focal point
          </p>
          <ImagePositionPicker
            src={item.image_url}
            positionX={item.image_position_x}
            positionY={item.image_position_y}
            onChange={(x, y) => onUpdate({ image_position_x: x, image_position_y: y })}
            aspectRatio={showLink ? "5/3" : "21/9"}
          />
        </div>
      )}
    </div>
  );
}

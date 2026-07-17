"use client";

import { useRef } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useFileUpload } from "@/lib/hooks/use-file-upload";
import { getImageUrl } from "@/lib/supabase/image-url";
import { toast } from "sonner";

export interface MediaValue {
  url: string;
  media_type: "image" | "video";
  thumbnail_url?: string;
}

interface MediaUploadProps {
  value: MediaValue | null;
  onChange: (value: MediaValue | null) => void;
}

/**
 * One input for images or videos — the file's MIME type decides which. Videos
 * over 20 MB are transcoded server-side, so the "processing" phase after the
 * upload bar fills can legitimately run for minutes.
 */
export function MediaUpload({ value, onChange }: MediaUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { phase, progress, error, upload } = useFileUpload("auto");

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = await upload(file);
    if (result) {
      onChange({
        url: result.url,
        media_type: result.mediaType ?? "image",
        thumbnail_url: result.thumbnailUrl,
      });
      toast.success("Media uploaded");
    } else if (error) {
      toast.error(error);
    }

    if (inputRef.current) inputRef.current.value = "";
  }

  const busy = phase === "uploading" || phase === "processing";

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleUpload}
      />

      {value ? (
        <div className="relative inline-block">
          {value.media_type === "video" ? (
            <video
              src={value.url}
              poster={value.thumbnail_url}
              controls
              playsInline
              preload="metadata"
              className="max-w-[300px] rounded-md border"
            />
          ) : (
            <img
              src={getImageUrl(value.url, { width: 600, quality: 70 })}
              alt=""
              className="max-w-[300px] rounded-md border object-cover"
            />
          )}
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute -right-2 -top-2 h-6 w-6"
            onClick={() => onChange(null)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : busy ? (
        <div className="max-w-[300px] space-y-2">
          {phase === "processing" ? <Progress indeterminate /> : <Progress value={progress} />}
          <p className="text-xs text-muted-foreground">
            {phase === "uploading" && `Uploading... ${progress}%`}
            {phase === "processing" && "Processing — large videos are re-encoded, this can take a while..."}
          </p>
        </div>
      ) : (
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" />
          Upload image or video
        </Button>
      )}
    </div>
  );
}

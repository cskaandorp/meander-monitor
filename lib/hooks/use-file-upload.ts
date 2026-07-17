import { useState, useCallback } from "react";

type UploadPhase = "idle" | "uploading" | "processing" | "done" | "error";

interface UploadState {
  phase: UploadPhase;
  progress: number; // 0-100 for uploading phase
  error: string | null;
}

export interface UploadResult {
  url: string;
  mediaType?: "image" | "video";
  thumbnailUrl?: string;
}

/**
 * `type` tells the server what to expect. "auto" lets the file's own MIME type
 * decide — used by the media block, where one input takes images or videos.
 */
export function useFileUpload(type: "image" | "video" | "auto") {
  const [state, setState] = useState<UploadState>({
    phase: "idle",
    progress: 0,
    error: null,
  });

  const upload = useCallback(
    (file: File): Promise<UploadResult | null> => {
      return new Promise((resolve) => {
        setState({ phase: "uploading", progress: 0, error: null });

        const formData = new FormData();
        formData.append("file", file);
        formData.append("type", type);

        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setState({ phase: "uploading", progress: pct, error: null });
          }
        });

        xhr.upload.addEventListener("loadend", () => {
          setState({ phase: "processing", progress: 100, error: null });
        });

        xhr.addEventListener("load", () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 400 || data.error) {
              setState({ phase: "error", progress: 0, error: data.error || "Upload failed" });
              resolve(null);
            } else {
              setState({ phase: "done", progress: 100, error: null });
              setTimeout(() => setState({ phase: "idle", progress: 0, error: null }), 1500);
              resolve({
                url: data.url,
                mediaType: data.mediaType,
                thumbnailUrl: data.thumbnailUrl,
              });
            }
          } catch {
            setState({ phase: "error", progress: 0, error: "Upload failed" });
            resolve(null);
          }
        });

        xhr.addEventListener("error", () => {
          setState({ phase: "error", progress: 0, error: "Upload failed" });
          resolve(null);
        });

        xhr.open("POST", "/api/upload");
        xhr.send(formData);
      });
    },
    [type]
  );

  const reset = useCallback(() => {
    setState({ phase: "idle", progress: 0, error: null });
  }, []);

  return { ...state, upload, reset };
}

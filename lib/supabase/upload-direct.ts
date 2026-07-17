import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Upload a file straight from the browser to Supabase Storage, with progress.
 *
 * Why not supabase.storage.upload()? It's fetch-based and reports no progress.
 * A volunteer sending 90 MB over 4G needs a bar, or they assume it's hung and
 * leave. This is the same REST endpoint the client library posts to, driven by
 * XHR so we get upload.onprogress.
 *
 * Going browser → Supabase directly (rather than via a Next server action) also
 * keeps the video out of the app server entirely: no 100 MB body limit, no
 * nginx timeout, no CPU on Patrick. RLS on storage.objects still applies — the
 * user's own access token is what authorises the write.
 */
export function uploadWithProgress(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  file: File,
  accessToken: string,
  onProgress: (percent: number) => void
): Promise<{ error?: string }> {
  return new Promise((resolve) => {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({});
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body.message) message = body.message;
        } catch {
          // non-JSON error body; keep the status-code message
        }
        resolve({ error: message });
      }
    });

    xhr.addEventListener("error", () =>
      resolve({ error: "Upload failed — check your connection" })
    );
    xhr.addEventListener("abort", () => resolve({ error: "Upload cancelled" }));

    xhr.open("POST", url);
    xhr.setRequestHeader("authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.setRequestHeader("x-upsert", "false");
    if (file.type) xhr.setRequestHeader("content-type", file.type);
    xhr.send(file);
  });
}

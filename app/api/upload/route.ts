import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadImage, uploadVideo, uploadMedia } from "@/lib/supabase/storage";

// Transcoding a large video holds this request open for minutes. nginx must
// allow for it too — proxy_read_timeout on mm.compunist.nl is 600s.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File;
  // Callers may say "image"/"video", but the file's own MIME type wins — the
  // media block lets you pick either from one input.
  const declared = formData.get("type") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const isVideo = file.type.startsWith("video/") || declared === "video";
  const isImage = file.type.startsWith("image/") || declared === "image";

  const ext = file.name.split(".").pop();
  const path = `pages/${Date.now()}.${ext}`;

  const result = isVideo
    ? await uploadVideo(file, path)
    : isImage
      ? await uploadImage(file, path)
      : await uploadMedia(file, path);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    url: result.url,
    mediaType: isVideo ? "video" : "image",
    thumbnailUrl: "thumbnailUrl" in result ? result.thumbnailUrl : undefined,
  });
}

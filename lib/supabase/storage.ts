import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "web";
const PUBLIC_URL_MARKER = `/storage/v1/object/public/${BUCKET}/`;
const MAX_WIDTH = 3000;

async function resizeImage(file: File): Promise<{ buffer: Buffer; contentType: string }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const image = sharp(buffer).rotate(); // auto-rotate based on EXIF
  const metadata = await image.metadata();

  if (metadata.width && metadata.width > MAX_WIDTH) {
    let resized = image.resize(MAX_WIDTH, undefined, { withoutEnlargement: true });

    if (file.type === "image/png") {
      resized = resized.png();
    } else {
      resized = resized.jpeg({ quality: 100 });
    }

    return { buffer: await resized.toBuffer(), contentType: file.type };
  }

  // Even if no resize needed, apply EXIF rotation
  const rotated = file.type === "image/png" ? image.png() : image.jpeg({ quality: 100 });
  return { buffer: await rotated.toBuffer(), contentType: file.type };
}

/** Upload an image, downscaled to MAX_WIDTH and EXIF-rotated. */
export async function uploadImage(
  file: File,
  path: string
): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();

  const { buffer, contentType } = await resizeImage(file);

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { upsert: true, contentType });

  if (error) {
    return { error: error.message };
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);

  return { url: urlData.publicUrl };
}

/** Upload any other website media as-is (no processing). */
export async function uploadMedia(
  file: File,
  path: string
): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();

  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { upsert: true, contentType: file.type });

  if (error) {
    return { error: error.message };
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);

  return { url: urlData.publicUrl };
}

export async function deleteMedia(url: string): Promise<{ error?: string }> {
  const supabase = await createClient();

  // Extract the storage path back out of the public URL
  const parts = url.split(PUBLIC_URL_MARKER);
  if (parts.length < 2) {
    return { error: "Invalid media URL" };
  }

  const { error } = await supabase.storage.from(BUCKET).remove([parts[1]]);

  if (error) {
    return { error: error.message };
  }

  return {};
}

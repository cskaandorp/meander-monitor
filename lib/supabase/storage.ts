import sharp from "sharp";
import ffmpeg from "fluent-ffmpeg";
import { createClient } from "@/lib/supabase/server";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const BUCKET = "web";
const PUBLIC_URL_MARKER = `/storage/v1/object/public/${BUCKET}/`;
const MAX_WIDTH = 3000;

// Videos above this get transcoded; below it they're small enough to serve as-is.
const VIDEO_SIZE_THRESHOLD = 20 * 1024 * 1024;
const VIDEO_MAX_HEIGHT = 720;

function publicUrl(path: string, supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

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

  return { url: publicUrl(path, supabase) };
}

/**
 * Re-encode to 720p H.264. Callers fall back to the original on failure —
 * ffmpeg is a system binary (`apt install ffmpeg`), not an npm dependency, so
 * a box without it throws here rather than at import time.
 */
async function compressVideo(buffer: Buffer): Promise<Buffer> {
  const tempDir = await mkdtemp(join(tmpdir(), "video-"));
  const inputPath = join(tempDir, "input");
  const outputPath = join(tempDir, "output.mp4");

  await writeFile(inputPath, buffer);

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          "-vf", `scale=-2:'min(${VIDEO_MAX_HEIGHT},ih)'`,
          "-c:v", "libx264",
          "-crf", "20",
          "-preset", "fast",
          "-c:a", "aac",
          "-b:a", "128k",
          // Moves the moov atom to the front so the browser can start playing
          // before the whole file arrives.
          "-movflags", "+faststart",
        ])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });

    return Buffer.from(await readFile(outputPath));
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

/** Grab a frame near the start as a WebP poster image. */
async function generateThumbnail(
  videoBuffer: Buffer,
  thumbnailPath: string
): Promise<string | null> {
  const supabase = await createClient();
  const tempDir = await mkdtemp(join(tmpdir(), "thumb-"));
  const inputPath = join(tempDir, "input.mp4");
  const outputPath = join(tempDir, "thumb.webp");

  await writeFile(inputPath, videoBuffer);

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .inputOptions(["-ss", "0.1"])
        .outputOptions(["-frames:v", "1", "-vf", "scale=400:-2", "-q:v", "80"])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });

    const thumbBuffer = Buffer.from(await readFile(outputPath));
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(thumbnailPath, thumbBuffer, {
        upsert: true,
        contentType: "image/webp",
      });

    return error ? null : publicUrl(thumbnailPath, supabase);
  } catch {
    return null;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

/**
 * Upload a video: transcode it if it's large, and generate a poster frame.
 *
 * A failed transcode uploads the original instead — that keeps a box without
 * ffmpeg working for small files, but note the original may then exceed the
 * bucket's file_size_limit and be rejected. If large uploads fail on a new box,
 * check that ffmpeg is installed before anything else.
 */
export async function uploadVideo(
  file: File,
  path: string
): Promise<{ url: string; thumbnailUrl?: string } | { error: string }> {
  const supabase = await createClient();

  // Widened deliberately: Buffer.from(arrayBuffer) narrows to Buffer<ArrayBuffer>,
  // but compressVideo returns readFile's wider Buffer<ArrayBufferLike>.
  let buffer: Buffer = Buffer.from(await file.arrayBuffer());
  let contentType = file.type;

  if (buffer.length > VIDEO_SIZE_THRESHOLD) {
    try {
      buffer = await compressVideo(buffer);
      contentType = "video/mp4";
      path = path.replace(/\.[^.]+$/, ".mp4");
    } catch (err) {
      console.error("Video compression failed, uploading original:", err);
    }
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { upsert: true, contentType });

  if (error) {
    return { error: error.message };
  }

  const thumbPath = `thumbs/${path.replace(/\.[^.]+$/, ".webp")}`;
  const thumbnailUrl = (await generateThumbnail(buffer, thumbPath)) ?? undefined;

  return { url: publicUrl(path, supabase), thumbnailUrl };
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

  return { url: publicUrl(path, supabase) };
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

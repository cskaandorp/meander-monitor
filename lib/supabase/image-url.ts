/**
 * Convert a Supabase Storage public URL to a transformed image URL.
 * Uses Supabase's built-in image transformation (no server-side processing needed).
 *
 * @see https://supabase.com/docs/guides/storage/serving/image-transformations
 */
export function getImageUrl(
  url: string,
  options?: { width?: number; height?: number; quality?: number }
): string {
  if (!options || (!options.width && !options.height)) return url;

  const transformed = url.replace(
    "/storage/v1/object/public/",
    "/storage/v1/render/image/public/"
  );

  const params = new URLSearchParams();
  if (options.width) params.set("width", String(options.width));
  if (options.height) params.set("height", String(options.height));
  if (options.quality) params.set("quality", String(options.quality));
  params.set("resize", "cover");

  return `${transformed}?${params.toString()}`;
}

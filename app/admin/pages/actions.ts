"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { deleteMedia } from "@/lib/supabase/storage";
import { pageSchema, contentBlockSchema, pageImageSchema } from "@/lib/schemas/page";
import { z } from "zod";

export async function createPage(data: {
  title?: string;
  slug: string;
  is_visible?: boolean;
}) {
  const parsed = pageSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { data: page, error } = await supabase
    .from("pages")
    .insert(parsed.data)
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/pages");
  return { page };
}

export async function updatePage(
  id: string,
  data: {
    title?: string;
    slug: string;
    is_visible?: boolean;
  }
) {
  const parsed = pageSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("pages").update(parsed.data).eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/pages");
  revalidatePath(`/${data.slug}`);
  return { success: true };
}

export async function deletePage(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("pages").delete().eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/pages");
  return { success: true };
}

export async function togglePageVisibility(id: string, is_visible: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("pages").update({ is_visible }).eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/pages");
  return { success: true };
}

const saveBlocksSchema = z.array(contentBlockSchema);
const saveImagesSchema = z.array(pageImageSchema);

export async function savePageWithBlocks(
  pageId: string | null,
  pageData: {
    title: string;
    slug: string;
    is_visible?: boolean;
    intro_text?: string | null;
    banner_url?: string | null;
    banner_position_x?: number;
    banner_position_y?: number;
  },
  blocks: {
    id: string;
    type: string;
    content: string;
    sort_order: number;
    timestamp?: string | null;
  }[],
  images: {
    id: string;
    image_url: string;
    position_x: number;
    position_y: number;
    sort_order: number;
  }[]
) {
  const pageDataParsed = {
    ...pageData,
    intro_text:
      typeof pageData.intro_text === "string"
        ? JSON.parse(pageData.intro_text)
        : pageData.intro_text,
  };
  const parsedPage = pageSchema.safeParse(pageDataParsed);
  if (!parsedPage.success) {
    return { error: parsedPage.error.issues[0].message };
  }

  const blocksWithParsedContent = blocks.map((b) => ({
    ...b,
    content: typeof b.content === "string" ? JSON.parse(b.content) : b.content,
  }));

  const parsedBlocks = saveBlocksSchema.safeParse(blocksWithParsedContent);
  if (!parsedBlocks.success) {
    return { error: parsedBlocks.error.issues[0].message };
  }

  const parsedImages = saveImagesSchema.safeParse(images);
  if (!parsedImages.success) {
    return { error: parsedImages.error.issues[0].message };
  }

  const supabase = await createClient();

  let finalPageId = pageId;

  if (pageId) {
    const { error } = await supabase
      .from("pages")
      .update(parsedPage.data)
      .eq("id", pageId);

    if (error) {
      return { error: error.message };
    }
  } else {
    const { data: newPage, error } = await supabase
      .from("pages")
      .insert(parsedPage.data)
      .select()
      .single();

    if (error) {
      return { error: error.message };
    }
    finalPageId = newPage.id;
  }

  // Blocks and images are replaced wholesale on save, so any image the editor
  // dropped is now unreferenced — delete the file before the row goes with it.
  if (pageId) {
    const { data: oldImages } = await supabase
      .from("page_images")
      .select("image_url")
      .eq("page_id", pageId);

    if (oldImages) {
      const newImageUrls = new Set(parsedImages.data.map((img) => img.image_url));
      await Promise.all(
        oldImages
          .filter((old) => !newImageUrls.has(old.image_url))
          .map((old) => deleteMedia(old.image_url))
      );
    }

    const [{ error: deleteBlocksError }, { error: deleteImagesError }] = await Promise.all([
      supabase.from("blocks").delete().eq("page_id", pageId),
      supabase.from("page_images").delete().eq("page_id", pageId),
    ]);

    if (deleteBlocksError) return { error: deleteBlocksError.message };
    if (deleteImagesError) return { error: deleteImagesError.message };
  }

  if (parsedBlocks.data.length > 0) {
    const blocksToInsert = parsedBlocks.data.map((block) => ({
      id: block.id,
      page_id: finalPageId!,
      type: block.type,
      title: block.title ?? null,
      content: block.content,
      sort_order: block.sort_order,
      timestamp: block.timestamp ?? null,
    }));

    const { error: insertError } = await supabase.from("blocks").insert(blocksToInsert);

    if (insertError) return { error: insertError.message };
  }

  if (parsedImages.data.length > 0) {
    const imagesToInsert = parsedImages.data.map((img) => ({
      id: img.id,
      page_id: finalPageId!,
      image_url: img.image_url,
      position_x: img.position_x,
      position_y: img.position_y,
      aspect_ratio: img.aspect_ratio,
      sort_order: img.sort_order,
    }));

    const { error: insertError } = await supabase
      .from("page_images")
      .insert(imagesToInsert);

    if (insertError) return { error: insertError.message };
  }

  revalidatePath("/admin/pages");
  if (parsedPage.data.slug) {
    revalidatePath(`/${parsedPage.data.slug}`);
  }

  return { success: true, pageId: finalPageId };
}

export async function updateMenuOrder(pages: { id: string; menu_order: number | null }[]) {
  const supabase = await createClient();

  for (const page of pages) {
    const { error } = await supabase
      .from("pages")
      .update({ menu_order: page.menu_order })
      .eq("id", page.id);

    if (error) return { error: error.message };
  }

  revalidatePath("/admin/pages");
  revalidatePath("/");
  return { success: true };
}

"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, ExternalLink, GripVertical, Trash2, Upload, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContentBlockEditor } from "./content-block-editor";
import { ImagePositionPicker } from "@/components/image-position-picker";
import { useFileUpload } from "@/lib/hooks/use-file-upload";
import { Progress } from "@/components/ui/progress";
import { getImageUrl } from "@/lib/supabase/image-url";
import { savePageWithBlocks } from "./actions";
import { generateSlug } from "@/lib/utils/slug";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import type { Page, ContentBlock, PageImage } from "@/lib/types/database";

const TiptapEditor = dynamic(
  () => import("@/components/tiptap-editor").then((m) => m.TiptapEditor),
  { ssr: false, loading: () => <div className="min-h-[120px] rounded-md border p-4" /> }
);

interface BlockState {
  id: string;
  type: string;
  title: string | null;
  content: Record<string, unknown>;
  sort_order: number;
  timestamp: string | null;
}

interface ImageState {
  id: string;
  image_url: string;
  position_x: number;
  position_y: number;
  aspect_ratio: string;
}

// Sortable image component
function SortablePageImage({
  image,
  onUpdate,
  onDelete,
}: {
  image: ImageState;
  onUpdate: (update: Partial<ImageState>) => void;
  onDelete: () => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="rounded-md border bg-card p-2">
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-1 cursor-grab text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <img
            src={getImageUrl(image.image_url, { width: 400, quality: 70 })}
            alt=""
            className="w-full rounded border object-cover"
            style={{
              aspectRatio: image.aspect_ratio,
              objectPosition: `${image.position_x}% ${image.position_y}%`,
            }}
          />
          <div className="flex items-center gap-1 mt-1">
            <select
              value={image.aspect_ratio}
              onChange={(e) => onUpdate({ aspect_ratio: e.target.value })}
              className="h-6 rounded border border-input bg-transparent px-1 text-xs"
            >
              <option value="1/1">1:1</option>
              <option value="4/3">4:3</option>
              <option value="3/2">3:2</option>
              <option value="16/9">16:9</option>
              <option value="3/4">3:4</option>
              <option value="2/3">2:3</option>
            </select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setShowPicker(!showPicker)}
            >
              {image.position_x !== 50 || image.position_y !== 50
                ? `Position: ${image.position_x}/${image.position_y}`
                : "Position"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 ml-auto text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          {showPicker && (
            <div className="mt-1">
              <ImagePositionPicker
                src={image.image_url}
                positionX={image.position_x}
                positionY={image.position_y}
                onChange={(x, y) => onUpdate({ position_x: x, position_y: y })}
                aspectRatio={image.aspect_ratio}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Image upload button
function ImageUploadButton({ onUpload }: { onUpload: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { phase, progress, error, upload } = useFileUpload("image");

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await upload(file);
    if (result) {
      onUpload(result.url);
    } else if (error) {
      toast.error(error);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  const busy = phase === "uploading" || phase === "processing";

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUpload}
      />
      {busy ? (
        <div className="flex items-center justify-center rounded-md border border-dashed p-4">
          {phase === "processing" ? (
            <Progress indeterminate className="w-24" />
          ) : (
            <Progress value={progress} className="w-24" />
          )}
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="mr-2 h-4 w-4" />
          Add image
        </Button>
      )}
    </>
  );
}

interface PageFormProps {
  page?: Page;
  blocks?: ContentBlock[];
  images?: PageImage[];
}

export function PageForm({ page, blocks: initialBlocks, images: initialImages }: PageFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(page?.title ?? "");
  const [slug, setSlug] = useState(page?.slug ?? "");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(!!page);
  const [isVisible, setIsVisible] = useState(page?.is_visible ?? false);
  const [bannerUrl, setBannerUrl] = useState<string | null>(page?.banner_url ?? null);
  const [bannerPositionX, setBannerPositionX] = useState(page?.banner_position_x ?? 50);
  const [bannerPositionY, setBannerPositionY] = useState(page?.banner_position_y ?? 50);
  const [showBannerPicker, setShowBannerPicker] = useState(false);
  const initialIntro = (page?.intro_text as Record<string, unknown>) ?? {};
  const [introText, setIntroText] = useState<Record<string, unknown>>(initialIntro);
  const [introOpen, setIntroOpen] = useState(
    !!page?.intro_text && JSON.stringify(page.intro_text).includes('"text"')
  );
  const [blocks, setBlocks] = useState<BlockState[]>(
    initialBlocks?.map((b) => ({
      id: b.id,
      type: b.type,
      title: b.title,
      content: b.content as Record<string, unknown>,
      sort_order: b.sort_order,
      timestamp: b.timestamp,
    })) ?? []
  );
  const [pageImages, setPageImages] = useState<ImageState[]>(
    initialImages?.map((img) => ({
      id: img.id,
      image_url: img.image_url,
      position_x: img.position_x,
      position_y: img.position_y,
      aspect_ratio: img.aspect_ratio,
    })) ?? []
  );
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!slugManuallyEdited) {
      setSlug(generateSlug(value));
    }
  }

  function handleSlugChange(value: string) {
    setSlugManuallyEdited(true);
    setSlug(value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
  }

  function addBlock() {
    setBlocks((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        type: "richtext",
        title: null,
        content: {},
        sort_order: prev.length,
        timestamp: null,
      },
    ]);
  }

  function deleteBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }

  const updateBlockContent = useCallback(
    (id: string, content: Record<string, unknown>) => {
      setBlocks((prev) =>
        prev.map((b) => (b.id === id ? { ...b, content } : b))
      );
    },
    []
  );

  const updateBlockType = useCallback((id: string, type: string) => {
    // Content shape is per-type, so switching resets it rather than leaving
    // a richtext document in a media block.
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, type, content: {} } : b))
    );
  }, []);

  const updateBlockTitle = useCallback(
    (id: string, title: string | null) => {
      setBlocks((prev) =>
        prev.map((b) => (b.id === id ? { ...b, title } : b))
      );
    },
    []
  );

  const updateBlockTimestamp = useCallback(
    (id: string, timestamp: string | null) => {
      setBlocks((prev) =>
        prev.map((b) => (b.id === id ? { ...b, timestamp } : b))
      );
    },
    []
  );

  function handleBlockDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setBlocks((prev) => {
      const oldIndex = prev.findIndex((b) => b.id === active.id);
      const newIndex = prev.findIndex((b) => b.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function handleImageDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setPageImages((prev) => {
      const oldIndex = prev.findIndex((img) => img.id === active.id);
      const newIndex = prev.findIndex((img) => img.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function addImage(url: string) {
    setPageImages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        image_url: url,
        position_x: 50,
        position_y: 50,
        aspect_ratio: "4/3",
      },
    ]);
  }

  function updateImage(id: string, update: Partial<ImageState>) {
    setPageImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, ...update } : img))
    );
  }

  function deleteImage(id: string) {
    setPageImages((prev) => prev.filter((img) => img.id !== id));
  }

  async function doSave() {
    if (!title.trim()) {
      toast.error("Title is required");
      return null;
    }
    if (!slug.trim()) {
      toast.error("Slug is required");
      return null;
    }

    setSaving(true);

    const hasIntro = introText && Object.keys(introText).length > 0;

    const blocksWithOrder = blocks.map((b, i) => ({
      ...b,
      content: JSON.stringify(b.content),
      sort_order: i,
    }));

    const imagesWithOrder = pageImages.map((img, i) => ({
      ...img,
      sort_order: i,
    }));

    const result = await savePageWithBlocks(
      page?.id ?? null,
      {
        title,
        slug,
        is_visible: isVisible,
        intro_text: hasIntro ? JSON.stringify(introText) : null,
        banner_url: bannerUrl,
        banner_position_x: bannerPositionX,
        banner_position_y: bannerPositionY,
      },
      blocksWithOrder,
      imagesWithOrder
    );

    setSaving(false);

    if (result.error) {
      toast.error(result.error);
      return null;
    }

    return result;
  }

  async function handleSave() {
    const result = await doSave();
    if (!result) return;
    toast.success(page ? "Page updated" : "Page created");
    router.push("/admin/pages");
  }

  async function handleSaveAndContinue() {
    const result = await doSave();
    if (!result) return;
    toast.success("Saved");
    if (!page && result.pageId) {
      router.replace(`/admin/pages/${result.pageId}`);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">
          {page ? "Edit page" : "New page"}
        </h2>
        <div className="flex items-center gap-3">
          {page?.is_visible && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={`/${page.slug}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                View page
              </a>
            </Button>
          )}
          <Button variant="outline" onClick={handleSaveAndContinue} disabled={saving}>
            {saving ? "Saving..." : "Save & continue"}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder="Page title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">/</span>
                  <Input
                    id="slug"
                    value={slug}
                    onChange={(e) => handleSlugChange(e.target.value)}
                    placeholder="page-slug"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              className="pb-4 cursor-pointer"
              onClick={() => setIntroOpen(!introOpen)}
            >
              <div className="flex items-center gap-2">
                {introOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <CardTitle className="text-base">Introduction (optional)</CardTitle>
              </div>
            </CardHeader>
            {introOpen && (
              <CardContent>
                <TiptapEditor content={introText} onChange={setIntroText} />
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-base">Content blocks</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addBlock}>
                <Plus className="mr-2 h-4 w-4" />
                Add block
              </Button>
            </CardHeader>
            <CardContent>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleBlockDragEnd}
              >
                <SortableContext
                  items={blocks.map((b) => b.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-4">
                    {blocks.map((block) => (
                      <ContentBlockEditor
                        key={block.id}
                        id={block.id}
                        type={block.type}
                        title={block.title}
                        content={block.content}
                        timestamp={block.timestamp}
                        onContentChange={(content) =>
                          updateBlockContent(block.id, content)
                        }
                        onTypeChange={(type) => updateBlockType(block.id, type)}
                        onTitleChange={(title) => updateBlockTitle(block.id, title)}
                        onTimestampChange={(ts) => updateBlockTimestamp(block.id, ts)}
                        onDelete={() => deleteBlock(block.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              {blocks.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  No content blocks yet. Click &quot;Add block&quot; to start.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Visibility</p>
                  <p className="text-xs text-muted-foreground">
                    {isVisible ? "Page is live" : "Page is hidden"}
                  </p>
                </div>
                <Switch
                  checked={isVisible}
                  onCheckedChange={setIsVisible}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-base">Banner (optional)</CardTitle>
              {bannerUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-destructive hover:text-destructive"
                  onClick={() => {
                    setBannerUrl(null);
                    setBannerPositionX(50);
                    setBannerPositionY(50);
                    setShowBannerPicker(false);
                  }}
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Remove
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {bannerUrl ? (
                <div className="space-y-2">
                  <img
                    src={getImageUrl(bannerUrl, { width: 800, quality: 70 })}
                    alt=""
                    className="w-full rounded border object-cover"
                    style={{
                      aspectRatio: "21/6",
                      objectPosition: `${bannerPositionX}% ${bannerPositionY}%`,
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setShowBannerPicker(!showBannerPicker)}
                  >
                    {bannerPositionX !== 50 || bannerPositionY !== 50
                      ? `Position: ${bannerPositionX}/${bannerPositionY}`
                      : "Adjust position"}
                  </Button>
                  {showBannerPicker && (
                    <ImagePositionPicker
                      src={bannerUrl}
                      positionX={bannerPositionX}
                      positionY={bannerPositionY}
                      onChange={(x, y) => {
                        setBannerPositionX(x);
                        setBannerPositionY(y);
                      }}
                      aspectRatio="21/6"
                    />
                  )}
                </div>
              ) : (
                <ImageUploadButton onUpload={(url) => setBannerUrl(url)} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-base">Images</CardTitle>
              <ImageUploadButton onUpload={addImage} />
            </CardHeader>
            <CardContent>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleImageDragEnd}
              >
                <SortableContext
                  items={pageImages.map((img) => img.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-3">
                    {pageImages.map((img) => (
                      <SortablePageImage
                        key={img.id}
                        image={img}
                        onUpdate={(update) => updateImage(img.id, update)}
                        onDelete={() => deleteImage(img.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              {pageImages.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">
                  No images yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

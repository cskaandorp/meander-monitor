"use client";

import { useState } from "react";
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
} from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LandingItemEditor } from "./landing-item-editor";
import { saveIntro, saveLandingItems } from "./actions";
import { toast } from "sonner";
import type { LandingItem, LandingItemType } from "@/lib/types/database";

interface ItemState {
  id: string;
  type: LandingItemType;
  title: string | null;
  image_url: string;
  link_url: string | null;
  image_position_x: number;
  image_position_y: number;
}

interface LandingFormProps {
  introTitle: string;
  introText: string;
  initialSlides: LandingItem[];
  initialTiles: LandingItem[];
}

export function LandingForm({ introTitle: initialTitle, introText: initialIntro, initialSlides, initialTiles }: LandingFormProps) {
  const router = useRouter();
  const [introTitle, setIntroTitle] = useState(initialTitle);
  const [intro, setIntro] = useState(initialIntro);
  const [slides, setSlides] = useState<ItemState[]>(
    initialSlides.map((s) => ({ id: s.id, type: s.type, title: s.title, image_url: s.image_url, link_url: s.link_url, image_position_x: s.image_position_x ?? 50, image_position_y: s.image_position_y ?? 50 }))
  );
  const [tiles, setTiles] = useState<ItemState[]>(
    initialTiles.map((t) => ({ id: t.id, type: t.type, title: t.title, image_url: t.image_url, link_url: t.link_url, image_position_x: t.image_position_x ?? 50, image_position_y: t.image_position_y ?? 50 }))
  );
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function addItem(type: LandingItemType) {
    const item: ItemState = {
      id: crypto.randomUUID(),
      type,
      title: null,
      image_url: "",
      link_url: null,
      image_position_x: 50,
      image_position_y: 50,
    };
    if (type === "slide") setSlides((prev) => [...prev, item]);
    else setTiles((prev) => [...prev, item]);
  }

  function updateItem(type: LandingItemType, id: string, update: Partial<ItemState>) {
    const setter = type === "slide" ? setSlides : setTiles;
    setter((prev) => prev.map((item) => (item.id === id ? { ...item, ...update } : item)));
  }

  function deleteItem(type: LandingItemType, id: string) {
    const setter = type === "slide" ? setSlides : setTiles;
    setter((prev) => prev.filter((item) => item.id !== id));
  }

  function handleDragEnd(type: LandingItemType) {
    return (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const setter = type === "slide" ? setSlides : setTiles;
      setter((prev) => {
        const oldIndex = prev.findIndex((i) => i.id === active.id);
        const newIndex = prev.findIndex((i) => i.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    };
  }

  async function handleSave() {
    // Validate: all items need an image
    const allItems = [...slides, ...tiles];
    const missing = allItems.find((i) => !i.image_url);
    if (missing) {
      toast.error("All items need an image");
      return;
    }

    setSaving(true);

    const introResult = await saveIntro(introTitle, intro);
    if (introResult.error) {
      toast.error(introResult.error);
      setSaving(false);
      return;
    }

    const itemsWithOrder = [
      ...slides.map((s, i) => ({ ...s, sort_order: i })),
      ...tiles.map((t, i) => ({ ...t, sort_order: i })),
    ];

    const result = await saveLandingItems(itemsWithOrder);
    setSaving(false);

    if (result.error) {
      toast.error(result.error);
      return;
    }

    toast.success("Landing page saved");
    router.push("/admin");
  }

  function renderSection(type: LandingItemType, items: ItemState[], label: string) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-base">{label}</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => addItem(type)}>
            <Plus className="mr-2 h-4 w-4" />
            Add {type}
          </Button>
        </CardHeader>
        <CardContent>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd(type)}
          >
            <SortableContext
              items={items.map((i) => i.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3">
                {items.map((item) => (
                  <LandingItemEditor
                    key={item.id}
                    item={item}
                    showLink={type === "tile"}
                    onUpdate={(update) => updateItem(type, item.id, update)}
                    onDelete={() => deleteItem(type, item.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {items.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-6">
              No {type}s yet. Click &quot;Add {type}&quot; to start.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Landing page</h2>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Intro</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="introTitle">Title</Label>
            <Input
              id="introTitle"
              value={introTitle}
              onChange={(e) => setIntroTitle(e.target.value)}
              placeholder="e.g. Welkom bij Boulderwijk"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="intro">Text</Label>
            <Textarea
              id="intro"
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              placeholder="Welcome text..."
              rows={4}
            />
          </div>
        </CardContent>
      </Card>

      {renderSection("slide", slides, "Slides")}
      {renderSection("tile", tiles, "Tiles")}
    </div>
  );
}

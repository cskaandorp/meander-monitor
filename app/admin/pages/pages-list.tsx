"use client";

import { useState } from "react";
import Link from "next/link";
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
import { GripVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PageListActions } from "./page-list-actions";
import { updateMenuOrder } from "./actions";
import { toast } from "sonner";
import type { Page } from "@/lib/types/database";

function SortablePageRow({
  page,
  onToggleMenu,
}: {
  page: Page;
  onToggleMenu: (id: string, inMenu: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-md border px-4 py-2.5"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <Link
        href={`/admin/pages/${page.id}`}
        className="font-medium hover:underline min-w-0 flex-1"
      >
        {page.title || "(untitled)"}
      </Link>

      <span className="text-sm text-muted-foreground">/{page.slug}</span>

      <div className="flex items-center gap-1.5">
        <Switch
          checked={page.menu_order !== null}
          onCheckedChange={(checked) => onToggleMenu(page.id, checked)}
          className="scale-75"
        />
        <Label className="text-xs text-muted-foreground">Nav</Label>
      </div>

      <Badge variant={page.is_visible ? "default" : "secondary"} className="shrink-0">
        {page.is_visible ? "Published" : "Draft"}
      </Badge>

      <PageListActions page={page} />
    </div>
  );
}

export function PagesList({ pages: initialPages }: { pages: Page[] }) {
  const router = useRouter();

  // Split into menu pages (sorted by menu_order) and non-menu pages
  const menuPages = initialPages
    .filter((p) => p.menu_order !== null)
    .sort((a, b) => (a.menu_order ?? 0) - (b.menu_order ?? 0));
  const otherPages = initialPages.filter((p) => p.menu_order === null);

  const [orderedPages, setOrderedPages] = useState([...menuPages, ...otherPages]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedPages.findIndex((p) => p.id === active.id);
    const newIndex = orderedPages.findIndex((p) => p.id === over.id);
    const newOrder = arrayMove(orderedPages, oldIndex, newIndex);
    setOrderedPages(newOrder);

    // Recalculate menu_order for pages that are in the nav
    const updates = newOrder
      .filter((p) => p.menu_order !== null)
      .map((p, i) => ({ id: p.id, menu_order: i }));

    const result = await updateMenuOrder(updates);
    if (result.error) {
      toast.error(result.error);
      setOrderedPages([...menuPages, ...otherPages]);
    } else {
      router.refresh();
    }
  }

  async function handleToggleMenu(id: string, inMenu: boolean) {
    const updated = orderedPages.map((p) =>
      p.id === id ? { ...p, menu_order: inMenu ? 999 : null } : p
    );
    setOrderedPages(updated);

    // Build updates: assign sequential menu_order to all nav pages
    const navPages = updated.filter((p) => p.menu_order !== null);
    const updates = [
      ...navPages.map((p, i) => ({ id: p.id, menu_order: i as number | null })),
      ...(inMenu ? [] : [{ id, menu_order: null as number | null }]),
    ];

    const result = await updateMenuOrder(updates);
    if (result.error) {
      toast.error(result.error);
      setOrderedPages([...menuPages, ...otherPages]);
    } else {
      router.refresh();
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Pages</h2>
        <Button asChild>
          <Link href="/admin/pages/new">
            <Plus className="mr-2 h-4 w-4" />
            New page
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">
            Drag to reorder navigation. Toggle "Nav" to show/hide in menu.
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedPages.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              {orderedPages.map((page) => (
                <SortablePageRow
                  key={page.id}
                  page={page}
                  onToggleMenu={handleToggleMenu}
                />
              ))}
            </SortableContext>
          </DndContext>

          {orderedPages.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-6">
              No pages yet. Create your first page.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

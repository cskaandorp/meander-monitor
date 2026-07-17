"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Plus, QrCode, Pencil, Trash2, Download, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createLocation, updateLocation, deleteLocation, toggleLocationActive } from "./actions";
import { generateSlug } from "@/lib/utils/slug";
import { SLUG_PATTERN } from "@/lib/schemas/location";
import { toast } from "sonner";

export interface Location {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
}

const EMPTY = {
  slug: "", name: "", description: "", latitude: "", longitude: "", is_active: true,
};

export function LocationsClient({ locations }: { locations: Location[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Location | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [qrFor, setQrFor] = useState<Location | null>(null);
  const [deleteFor, setDeleteFor] = useState<Location | null>(null);

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setSlugTouched(false);
    setFormOpen(true);
  }

  function openEdit(l: Location) {
    setEditing(l);
    setForm({
      slug: l.slug,
      name: l.name,
      description: l.description ?? "",
      latitude: l.latitude?.toString() ?? "",
      longitude: l.longitude?.toString() ?? "",
      is_active: l.is_active,
    });
    setSlugTouched(true); // never re-derive an existing slug: it's in printed codes
    setFormOpen(true);
  }

  async function handleSave() {
    const payload = {
      slug: form.slug,
      name: form.name,
      description: form.description || null,
      latitude: form.latitude ? Number(form.latitude) : null,
      longitude: form.longitude ? Number(form.longitude) : null,
      is_active: form.is_active,
    };

    if (!SLUG_PATTERN.test(payload.slug)) {
      toast.error("Slug must be lowercase letters, numbers and single hyphens");
      return;
    }

    setSaving(true);
    const result = editing
      ? await updateLocation(editing.id, payload)
      : await createLocation(payload);
    setSaving(false);

    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(editing ? "Location updated" : "Location created");
    setFormOpen(false);
    router.refresh();
  }

  async function handleToggle(l: Location) {
    const result = await toggleLocationActive(l.id, !l.is_active);
    if (result.error) toast.error(result.error);
    else router.refresh();
  }

  async function handleDelete() {
    if (!deleteFor) return;
    const result = await deleteLocation(deleteFor.id);
    if (result.error) toast.error(result.error);
    else {
      toast.success("Location deleted");
      router.refresh();
    }
    setDeleteFor(null);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold">Locations</h2>
        <Button onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" />
          New location
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-2 pt-6">
          {locations.map((l) => (
            <div key={l.id} className="flex items-center gap-3 rounded-md border px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{l.name}</p>
                <p className="text-sm text-muted-foreground">/submit/{l.slug}</p>
              </div>

              {(l.latitude !== null || l.longitude !== null) && (
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {l.latitude}, {l.longitude}
                </span>
              )}

              <Badge variant={l.is_active ? "default" : "secondary"}>
                {l.is_active ? "Active" : "Retired"}
              </Badge>

              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setQrFor(l)}>
                <QrCode className="h-4 w-4" />
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEdit(l)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleToggle(l)}>
                    {l.is_active ? "Retire" : "Reactivate"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDeleteFor(l)}
                    className="text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}

          {locations.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No locations yet. Create one, then print its QR code for the sign.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Create / edit */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit location" : "New location"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "The slug is in any QR code already printed for this location — changing it makes those signs dead links."
                : "The slug becomes the QR code URL. Choose carefully: once a sign is printed, it can't be changed."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((f) => ({
                    ...f,
                    name,
                    slug: slugTouched ? f.slug : generateSlug(name),
                  }));
                }}
                placeholder="Beek Noord"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug">Slug</Label>
              <div className="flex items-center gap-2">
                <span className="whitespace-nowrap text-sm text-muted-foreground">/submit/</span>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setForm((f) => ({ ...f, slug: e.target.value }));
                  }}
                  placeholder="beek-noord"
                />
              </div>
              {form.slug && !SLUG_PATTERN.test(form.slug) && (
                <p className="text-xs text-destructive">
                  Lowercase letters, numbers and single hyphens only
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Shown to the volunteer on the recording page"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="lat">Latitude (optional)</Label>
                <Input
                  id="lat"
                  value={form.latitude}
                  onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))}
                  placeholder="52.093"
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lon">Longitude (optional)</Label>
                <Input
                  id="lon"
                  value={form.longitude}
                  onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))}
                  placeholder="5.121"
                  inputMode="decimal"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">
                  Retired locations stop accepting recordings
                </p>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QrDialog location={qrFor} onClose={() => setQrFor(null)} />

      <AlertDialog open={!!deleteFor} onOpenChange={(o) => !o && setDeleteFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete location</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{deleteFor?.name}&quot;? Any QR code printed for it becomes a
              dead link. If it already has recordings, deletion will be refused — retire
              it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function QrDialog({ location, onClose }: { location: Location | null; onClose: () => void }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!location) {
      setSvg(null);
      return;
    }
    // origin rather than a configured base URL: the QR must point at whatever
    // host the admin is actually using, so it's right in dev and in prod.
    const target = `${window.location.origin}/submit/${location.slug}`;
    setUrl(target);
    QRCode.toString(target, {
      type: "svg",
      // High correction: these are printed, mounted outdoors, and read in the
      // rain by a phone camera. Redundancy is worth the density.
      errorCorrectionLevel: "H",
      margin: 2,
      width: 512,
    }).then(setSvg);
  }, [location]);

  function download() {
    if (!svg || !location) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `qr-${location.slug}.svg`;
    a.click();
    URL.revokeObjectURL(href);
  }

  return (
    <Dialog open={!!location} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{location?.name}</DialogTitle>
          <DialogDescription className="break-all">{url}</DialogDescription>
        </DialogHeader>

        {svg && (
          <div
            className="mx-auto w-full max-w-[280px] [&>svg]:h-auto [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={download} disabled={!svg}>
            <Download className="mr-2 h-4 w-4" />
            Download SVG
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

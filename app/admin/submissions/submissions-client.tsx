"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Trash2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteSubmissions } from "./actions";
import { toast } from "sonner";

export interface SubmissionRow {
  id: string;
  user_id: string;
  storage_path: string;
  result_path: string | null;
  result: Record<string, unknown> | null;
  status: "queued" | "processing" | "done" | "failed";
  error: string | null;
  created_at: string;
  locations: { slug: string; name: string } | null;
}

const PAGE_SIZE = 25;

const STATUS_VARIANT: Record<SubmissionRow["status"], "default" | "secondary" | "destructive"> = {
  done: "default",
  failed: "destructive",
  queued: "secondary",
  processing: "secondary",
};

interface Preview {
  rawUrl?: string;
  resultUrl?: string;
  loading: boolean;
}

export function SubmissionsClient({ rows }: { rows: SubmissionRow[] }) {
  const router = useRouter();
  const supabase = useState(() => createClient())[0];

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Date-range filter, inclusive. `to` extends to end-of-day so the whole day counts.
  const filtered = useMemo(() => {
    const fromT = from ? new Date(from).getTime() : -Infinity;
    const toT = to ? new Date(to).getTime() + 86_400_000 : Infinity;
    return rows.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= fromT && t <= toT;
    });
  }, [rows, from, to]);

  // Client-side pagination of the filtered set. Selection lives above the page
  // boundary, so "select all" spans every page — which is what bulk delete over
  // a whole range wants. (If volume ever outgrows the 1000-row fetch cap, this
  // is the point to move to server-side .range() pagination.)
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => setPage(0), [from, to]); // new filter → back to first page
  useEffect(() => setPage((p) => Math.min(p, pageCount - 1)), [pageCount]); // clamp
  const paged = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(filtered.map((r) => r.id)));
  }

  async function loadPreview(r: SubmissionRow) {
    if (previews[r.id]) return; // already fetched; expand/collapse is separate
    setPreviews((p) => ({ ...p, [r.id]: { loading: true } }));

    const [raw, result] = await Promise.all([
      supabase.storage.from("submissions").createSignedUrl(r.storage_path, 3600),
      r.result_path
        ? supabase.storage.from("results").createSignedUrl(r.result_path, 3600)
        : Promise.resolve({ data: null }),
    ]);

    setPreviews((p) => ({
      ...p,
      [r.id]: {
        loading: false,
        rawUrl: raw.data?.signedUrl,
        resultUrl: result.data?.signedUrl,
      },
    }));
  }

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggleExpand(r: SubmissionRow) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(r.id)) next.delete(r.id);
      else {
        next.add(r.id);
        loadPreview(r);
      }
      return next;
    });
  }

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteSubmissions([...selected]);
    setDeleting(false);
    setDeleteOpen(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`Deleted ${result.deleted} submission(s) and their files`);
    setSelected(new Set());
    router.refresh();
  }

  const downloadHref = `/api/admin/download?${new URLSearchParams({
    ...(from ? { from: new Date(from).toISOString() } : {}),
    ...(to ? { to: new Date(new Date(to).getTime() + 86_400_000).toISOString() } : {}),
  }).toString()}`;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-2xl font-bold">Submissions</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="from" className="text-xs">From</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to" className="text-xs">To</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
          </div>
          <Button asChild variant="outline">
            <a href={downloadHref}>
              <Download className="mr-2 h-4 w-4" />
              Download {from || to ? "range" : "all"} (zip)
            </a>
          </Button>
          <Button
            variant="destructive"
            disabled={selected.size === 0}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete{selected.size ? ` (${selected.size})` : ""}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="mb-2 flex items-center gap-3 border-b pb-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            <span>{filtered.length} in range{selected.size ? `, ${selected.size} selected` : ""}</span>
          </div>

          <div className="space-y-1">
            {paged.map((r) => (
              <div key={r.id} className="rounded-md border">
                <div className="flex items-center gap-3 px-3 py-2">
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => toggleExpand(r)}
                  >
                    {expanded.has(r.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {r.locations?.name ?? "—"}
                    <span className="ml-2 text-xs text-muted-foreground">{r.user_id.slice(0, 8)}</span>
                  </span>
                  <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("nl-NL", {
                      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                </div>

                {expanded.has(r.id) && (
                  <div className="border-t px-3 py-3">
                    {previews[r.id]?.loading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">Raw upload</p>
                          {previews[r.id]?.rawUrl ? (
                            <video src={previews[r.id]!.rawUrl} controls playsInline preload="metadata" className="w-full rounded" />
                          ) : (
                            <p className="text-xs text-muted-foreground">unavailable</p>
                          )}
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">Result</p>
                          {previews[r.id]?.resultUrl ? (
                            <img src={previews[r.id]!.resultUrl} alt="Result" className="w-full rounded" />
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {r.status === "failed" ? r.error ?? "failed" : "no result"}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {filtered.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No submissions in this range.</p>
            )}
          </div>

          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-muted-foreground">
                Page {page + 1} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} submission(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the raw videos, their results, and the records
              from the database. It frees the disk and cannot be undone. Download first
              if you need to keep the footage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

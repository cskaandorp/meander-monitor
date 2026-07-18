import { NextRequest } from "next/server";
import { Readable } from "node:stream";
import { ZipFile } from "yazl";
import { createClient } from "@/lib/supabase/server";

// Node runtime: archiver is a Node stream library, and we stream the zip out
// rather than buffering it. force-dynamic so it never gets cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Row {
  id: string;
  user_id: string;
  storage_path: string;
  result_path: string | null;
  status: string;
  created_at: string;
  locations: { slug: string; name: string } | null;
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  // Admin only. The /admin proxy guards the UI, but this endpoint is hit
  // directly, so it must check for itself.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return new Response("Forbidden", { status: 403 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = supabase
    .from("submissions")
    .select("id, user_id, storage_path, result_path, status, created_at, locations(slug, name)")
    .order("created_at", { ascending: true });
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data, error } = await query;
  if (error) return new Response(error.message, { status: 500 });
  const rows = (data as unknown as Row[]) ?? [];

  const zip = new ZipFile();
  const webStream = Readable.toWeb(
    zip.outputStream as unknown as Readable
  ) as ReadableStream<Uint8Array>;

  // Fill the zip in the background, one source file in memory at a time, so it
  // streams to the client without ever holding the whole archive. `compress:
  // false` — the media is already compressed, so store-only saves CPU.
  (async () => {
    try {
      const header = "id,created_at,location_slug,location_name,status,raw_path,result_path\n";
      const lines = rows.map((r) =>
        [
          r.id,
          r.created_at,
          r.locations?.slug,
          r.locations?.name,
          r.status,
          r.storage_path,
          r.result_path ?? "",
        ]
          .map(csvCell)
          .join(",")
      );
      zip.addBuffer(Buffer.from(header + lines.join("\n") + "\n"), "manifest.csv", { compress: false });

      for (const r of rows) {
        const folder = `${r.locations?.slug ?? "unknown"}/${r.id}`;

        const raw = await supabase.storage.from("submissions").download(r.storage_path);
        if (raw.data) {
          const ext = r.storage_path.split(".").pop() || "mp4";
          zip.addBuffer(Buffer.from(await raw.data.arrayBuffer()), `${folder}/raw.${ext}`, { compress: false });
        }

        if (r.result_path) {
          const res = await supabase.storage.from("results").download(r.result_path);
          if (res.data) {
            const ext = r.result_path.split(".").pop() || "png";
            zip.addBuffer(Buffer.from(await res.data.arrayBuffer()), `${folder}/result.${ext}`, { compress: false });
          }
        }
      }
    } finally {
      zip.end();
    }
  })();

  const stamp = (from ?? "all").slice(0, 10);
  return new Response(webStream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="submissions-${stamp}.zip"`,
    },
  });
}

import type { Metadata } from "next";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Send us a video",
};

// Reached by anyone who types /submit rather than scanning a code. A recording
// is meaningless without knowing where it was taken, so there is no location-
// less submit form — send them to pick one instead.
export default async function SubmitIndexPage() {
  const supabase = await createClient();
  const { data: locations } = await supabase
    .from("locations")
    .select("slug, name, description")
    .eq("is_active", true)
    .order("name");

  return (
    <div className="container mx-auto max-w-md px-4 py-10">
      <h1 className="text-3xl font-bold">Send us a video</h1>
      <p className="mt-2 mb-8 text-muted-foreground">
        Scan the QR code on the sign at a monitoring location to record there. Or
        pick one below.
      </p>

      {locations?.length ? (
        <div className="space-y-3">
          {locations.map((l) => (
            <Link
              key={l.slug}
              href={`/submit/${l.slug}`}
              className="flex items-start gap-3 rounded-lg border p-4 transition-colors hover:border-primary/50"
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="font-medium">{l.name}</p>
                {l.description && (
                  <p className="text-sm text-muted-foreground">{l.description}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No monitoring locations are active yet.
        </p>
      )}
    </div>
  );
}

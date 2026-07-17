import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SubmitClient } from "../submit-client";

interface PageProps {
  params: Promise<{ location: string }>;
}

async function getLocation(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("locations")
    .select("id, slug, name, description")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { location: slug } = await params;
  const location = await getLocation(slug);
  return { title: location ? `Send us a video — ${location.name}` : "Not found" };
}

export default async function SubmitAtLocationPage({ params }: PageProps) {
  const { location: slug } = await params;
  const location = await getLocation(slug);

  // Unknown or retired slug. A printed sign outlives the code on it, so this
  // is a real path: a QR from a decommissioned spot should say so plainly
  // rather than silently accept a recording nobody will use.
  if (!location) {
    notFound();
  }

  return (
    <div className="container mx-auto max-w-md px-4 py-10">
      <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-primary">
        <MapPin className="h-4 w-4" />
        {location.name}
      </div>
      <h1 className="text-3xl font-bold">Send us a video</h1>
      <p className="mt-2 mb-8 text-muted-foreground">
        {location.description ??
          "Record the river here. We process it and send the result back to this page — you don't need an account."}
      </p>
      <SubmitClient locationId={location.id} locationSlug={location.slug} />
    </div>
  );
}

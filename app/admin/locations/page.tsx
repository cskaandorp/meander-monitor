import { createClient } from "@/lib/supabase/server";
import { LocationsClient, type Location } from "./locations-client";

export default async function LocationsAdminPage() {
  const supabase = await createClient();
  const { data: locations } = await supabase
    .from("locations")
    .select("*")
    .order("is_active", { ascending: false })
    .order("name");

  return <LocationsClient locations={(locations as Location[]) ?? []} />;
}

import Link from "next/link";
import { FileText, Layout, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const links = [
  { href: "/admin/landing", label: "Landing", description: "Manage the landing page", icon: Layout },
  { href: "/admin/pages", label: "Pages", description: "Create and manage pages", icon: FileText },
  { href: "/admin/locations", label: "Locations", description: "Monitoring spots and QR codes", icon: MapPin },
];

export default function AdminDashboard() {
  return (
    <div>
      <h2 className="text-2xl font-bold">Dashboard</h2>
      <p className="mt-1 text-muted-foreground">Manage your website content.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {links.map((link) => (
          <Link key={link.href} href={link.href}>
            <Card className="transition-colors hover:border-primary/50 hover:shadow-sm">
              <CardContent className="flex items-center gap-4 p-5">
                <div className="rounded-lg bg-primary/10 p-2.5">
                  <link.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold">{link.label}</p>
                  <p className="text-sm text-muted-foreground">{link.description}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/admin/landing", label: "Landing" },
  { href: "/admin/pages", label: "Pages" },
  { href: "/admin/locations", label: "Locations" },
  { href: "/admin/submissions", label: "Submissions" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {navItems.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

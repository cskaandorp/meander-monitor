"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface NavPage {
  id: string;
  title: string;
  slug: string;
}

function MobileNavLink({
  href,
  label,
  pathname,
  onNavigate,
}: {
  href: string;
  label: string;
  pathname: string;
  onNavigate: () => void;
}) {
  const isActive = pathname === href;
  return (
    <div
      className={`border-l-[3px] pl-4 ${isActive ? "border-accent" : "border-transparent"}`}
    >
      <Link
        href={href}
        className={`block py-2.5 text-base font-medium transition-colors hover:text-foreground ${
          isActive ? "text-primary" : "text-muted-foreground"
        }`}
        onClick={onNavigate}
      >
        {label}
      </Link>
    </div>
  );
}

export function MobileNav({ pages }: { pages: NavPage[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="desktop-nav:hidden h-12 w-12 absolute right-4 top-1/2 -translate-y-1/2">
          <Menu className="!h-9 !w-9" />
          <span className="sr-only">Menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-64 border-l-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col pt-8 pb-4">
          <MobileNavLink href="/" label="Home" pathname={pathname} onNavigate={() => setOpen(false)} />
          {pages.map((page) => (
            <MobileNavLink
              key={page.id}
              href={`/${page.slug}`}
              label={page.title}
              pathname={pathname}
              onNavigate={() => setOpen(false)}
            />
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

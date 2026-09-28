"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const activeClass = "text-sm font-medium text-primary transition-colors";
const defaultClass = "text-sm text-muted-foreground hover:text-foreground transition-colors";

function ActiveBar() {
  return <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-accent" />;
}

interface NavPage {
  id: string;
  title: string;
  slug: string;
  /** Set when this entry is a link to a page rendered outside the CMS. */
  link_url?: string | null;
}

/** A link-only entry points at link_url; a normal page at its slug. */
export function navHref(page: NavPage): string {
  return page.link_url || `/${page.slug}`;
}

export function DesktopNav({ pages }: { pages: NavPage[] }) {
  const pathname = usePathname();

  return (
    <nav className="hidden desktop-nav:flex items-end gap-10">
      <div className="relative group pb-4">
        <Link href="/" className={pathname === "/" ? activeClass : defaultClass}>
          Home
        </Link>
        {pathname === "/" && <ActiveBar />}
      </div>
      {pages.map((page) => {
        const href = navHref(page);
        const isActive = pathname === href;
        return (
          <div key={page.id} className="relative group pb-4">
            <Link href={href} className={isActive ? activeClass : defaultClass}>
              {page.title}
            </Link>
            {isActive && <ActiveBar />}
          </div>
        );
      })}
    </nav>
  );
}

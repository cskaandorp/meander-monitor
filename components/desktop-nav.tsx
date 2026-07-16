"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const activeClass = "text-sm font-medium text-orange-500 transition-colors";
const defaultClass = "text-sm text-muted-foreground hover:text-foreground transition-colors";

function ActiveBar() {
  return <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-orange-500" />;
}

interface NavPage {
  id: string;
  title: string;
  slug: string;
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
        const href = `/${page.slug}`;
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

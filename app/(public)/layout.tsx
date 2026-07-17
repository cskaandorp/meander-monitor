import { PublicNav } from "@/components/public-nav";
import { PublicFooter } from "@/components/public-footer";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // `theme-wur` scopes the WUR palette to the public site — /admin sits outside
  // this layout and keeps the neutral shadcn defaults. See app/globals.css.
  return (
    <div className="theme-wur min-h-screen bg-background text-foreground">
      <PublicNav />
      <main>{children}</main>
      <PublicFooter />
    </div>
  );
}

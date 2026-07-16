export function PublicFooter() {
  return (
    <footer className="mt-12 border-t py-8">
      <div className="container mx-auto px-4 text-sm text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} Meander Monitor</p>
      </div>
    </footer>
  );
}

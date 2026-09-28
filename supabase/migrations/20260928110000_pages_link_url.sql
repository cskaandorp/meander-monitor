-- Let a page row be a NAVIGATION LINK instead of a content page.
--
-- The public nav is built entirely from `pages` (is_visible + menu_order), and
-- every entry links to /<slug>. That works until a page is rendered by real
-- code rather than by the CMS — /water is the first, a public locations page is
-- the next — because such a route has no `pages` row, so there is no way to put
-- it in the menu, reorder it, rename it or hide it without editing components.
--
-- The fix that was NOT taken: a separate `nav_links` table. Ordering is the
-- reason. `menu_order` is one sequence across the whole menu, and the admin
-- reorder screen drags rows within it; two tables would mean two sequences to
-- interleave and a reorder UI that has to merge them. One table, one order.
--
-- When link_url is set, the row is a link and nothing else: the nav points at
-- link_url rather than /<slug>, and /<slug> redirects there rather than
-- rendering an empty content page. Title, menu_order and is_visible keep their
-- usual meaning, so such an entry is renamed, reordered and hidden exactly like
-- any other.
alter table pages
  add column link_url text;

-- Either a site-relative path ("/water") or an absolute URL. Anything else —
-- "water", "javascript:…" — is a mistake that would render a broken or
-- dangerous menu item, and it is cheaper to refuse it here than to sanitise it
-- in every component that renders a nav.
alter table pages
  add constraint pages_link_url_format
  check (link_url is null or link_url ~ '^(/|https?://)');

comment on column pages.link_url is
  'When set, this row is a navigation link only: the menu points here and /<slug> redirects. Used for pages rendered outside the CMS (e.g. /water).';

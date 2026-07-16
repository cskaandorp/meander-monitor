-- Pages, blocks and landing content — the public website.
--
-- Consolidated from boulderwijk's CMS migrations, reduced to the page/landing
-- surface (no staff, beta videos, events, opening hours, google tokens) and
-- squashed to the end state: boulderwijk's history renames content_blocks to
-- blocks, adds and later drops block images, and replaces menu_items with
-- pages.menu_order. Replaying that churn on a fresh database has no value, so
-- this is the shape those migrations arrive at, written once.

-- ── Shared trigger: keep updated_at honest ────────────────────────────────
create or replace function handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ── Pages ─────────────────────────────────────────────────────────────────
create table pages (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  slug              text unique not null,
  intro_text        jsonb,
  is_visible        boolean default false,
  menu_order        integer,                          -- null = not in the nav
  banner_url        text,
  banner_position_x integer not null default 50,      -- focal point, percent
  banner_position_y integer not null default 50,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create trigger pages_updated_at
  before update on pages
  for each row execute function handle_updated_at();

alter table pages enable row level security;

create policy "Public can read visible pages"
  on pages for select
  using (is_visible = true);

create policy "Authenticated users have full access to pages"
  on pages for all to authenticated
  using (true) with check (true);

-- ── Blocks — the rich-text body of a page ─────────────────────────────────
create table blocks (
  id         uuid primary key default gen_random_uuid(),
  page_id    uuid not null references pages(id) on delete cascade,
  type       text default 'richtext',
  title      text,
  content    jsonb default '{}'::jsonb,               -- Tiptap document
  timestamp  timestamptz,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index blocks_page_id_idx on blocks (page_id);

create trigger blocks_updated_at
  before update on blocks
  for each row execute function handle_updated_at();

alter table blocks enable row level security;

create policy "Public can read blocks of visible pages"
  on blocks for select
  using (
    exists (select 1 from pages where pages.id = blocks.page_id and pages.is_visible = true)
  );

create policy "Authenticated users have full access to blocks"
  on blocks for all to authenticated
  using (true) with check (true);

-- ── Page images — a gallery per page ──────────────────────────────────────
create table page_images (
  id           uuid primary key default gen_random_uuid(),
  page_id      uuid not null references pages(id) on delete cascade,
  image_url    text not null,
  position_x   integer not null default 50,           -- focal point, percent
  position_y   integer not null default 50,
  aspect_ratio text not null default '4/3',
  sort_order   integer not null default 0,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index page_images_page_id_idx on page_images (page_id);

create trigger page_images_updated_at
  before update on page_images
  for each row execute function handle_updated_at();

alter table page_images enable row level security;

create policy "Public can view page images"
  on page_images for select
  using (true);

create policy "Authenticated users can manage page images"
  on page_images for all to authenticated
  using (true) with check (true);

-- ── Site settings — key/value for simple site-wide config ─────────────────
create table site_settings (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,
  value      text not null default '',
  updated_at timestamptz default now()
);

create trigger site_settings_updated_at
  before update on site_settings
  for each row execute function handle_updated_at();

alter table site_settings enable row level security;

create policy "Public can read site settings"
  on site_settings for select
  using (true);

create policy "Authenticated users have full access to site settings"
  on site_settings for all to authenticated
  using (true) with check (true);

insert into site_settings (key, value) values
  ('intro_title', ''),
  ('intro_text', '');

-- ── Landing items — slides and tiles on the landing page ──────────────────
create table landing_items (
  id                uuid primary key default gen_random_uuid(),
  type              text not null check (type in ('slide', 'tile')),
  title             text,
  image_url         text not null,
  link_url          text,
  image_position_x  integer not null default 50,      -- focal point, percent
  image_position_y  integer not null default 50,
  sort_order        integer not null default 0,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create trigger landing_items_updated_at
  before update on landing_items
  for each row execute function handle_updated_at();

alter table landing_items enable row level security;

create policy "Public can read landing items"
  on landing_items for select
  using (true);

create policy "Authenticated users have full access to landing items"
  on landing_items for all to authenticated
  using (true) with check (true);

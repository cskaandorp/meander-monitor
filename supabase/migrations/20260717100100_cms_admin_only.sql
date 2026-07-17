-- Restrict the CMS to admins.
--
-- The initial policies granted every authenticated user full access to the site
-- content. With volunteer accounts arriving, that would let any uploader edit or
-- delete pages. Swap "to authenticated" for is_admin().
--
-- Public SELECT policies are untouched — anonymous visitors still read visible
-- pages exactly as before.

drop policy "Authenticated users have full access to pages" on pages;
create policy "Admins have full access to pages"
  on pages for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy "Authenticated users have full access to blocks" on blocks;
create policy "Admins have full access to blocks"
  on blocks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy "Authenticated users can manage page images" on page_images;
create policy "Admins can manage page images"
  on page_images for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy "Authenticated users have full access to site settings" on site_settings;
create policy "Admins have full access to site settings"
  on site_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy "Authenticated users have full access to landing items" on landing_items;
create policy "Admins have full access to landing items"
  on landing_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Website media: only admins may write. Public read stays — banners and gallery
-- images are served straight from the bucket by <img src>.
drop policy "Authenticated users can upload web media" on storage.objects;
create policy "Admins can upload web media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'web' and public.is_admin());

drop policy "Authenticated users can update web media" on storage.objects;
create policy "Admins can update web media"
  on storage.objects for update to authenticated
  using (bucket_id = 'web' and public.is_admin());

drop policy "Authenticated users can delete web media" on storage.objects;
create policy "Admins can delete web media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'web' and public.is_admin());

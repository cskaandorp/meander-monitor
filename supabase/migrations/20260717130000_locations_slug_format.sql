-- Constrain slug format.
--
-- Slugs end up printed on QR codes bolted to posts by the water. A slug with a
-- space or a capital survives the database but becomes /submit/Beek%20Noord in
-- the code — ugly, and unreadable to anyone trying to type it off the sign.
-- That is the one mistake here software cannot fix afterwards: the sign is
-- already in the field.
--
-- lowercase alphanumerics, single hyphens between, no leading/trailing hyphen.
alter table locations
  add constraint locations_slug_format
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Track what language a recipe's name was written in.
-- NULL = system recipe (has translations, language-agnostic).
-- 'pt', 'en', etc. = user recipe stored in that language.
alter table recipes add column name_language text;

-- Backfill: user recipes that accidentally got a translation row — use that language.
update recipes r
set name_language = (
  select rt.language
  from recipe_translations rt
  where rt.recipe_id = r.id
  order by rt.language
  limit 1
)
where r.owner_id is not null
  and exists (select 1 from recipe_translations rt where rt.recipe_id = r.id);

-- Backfill: remaining user recipes default to 'pt' (app was PT-first, early users are PT).
update recipes
set name_language = 'pt'
where owner_id is not null and name_language is null;

-- Remove stale translation rows for user recipes — translations are system-only.
delete from recipe_step_translations
where step_id in (
  select rs.id from recipe_steps rs
  join recipes r on r.id = rs.recipe_id
  where r.owner_id is not null
);

delete from recipe_ingredient_translations
where ingredient_id in (
  select ri.id from recipe_ingredients ri
  join recipes r on r.id = ri.recipe_id
  where r.owner_id is not null
);

delete from recipe_translations
where recipe_id in (
  select id from recipes where owner_id is not null
);

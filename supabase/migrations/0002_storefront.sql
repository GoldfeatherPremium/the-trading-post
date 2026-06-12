ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS store_banner_url text,
  ADD COLUMN IF NOT EXISTS store_logo_url text,
  ADD COLUMN IF NOT EXISTS store_description text,
  ADD COLUMN IF NOT EXISTS store_socials jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS store_announcement text,
  ADD COLUMN IF NOT EXISTS avg_response_minutes integer NOT NULL DEFAULT 0;

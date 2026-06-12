-- Phase 2: search analytics + recommendation indexes
CREATE TABLE IF NOT EXISTS public.search_queries (
  id bigint generated always as identity primary key,
  query text NOT NULL,
  user_id text,
  results integer NOT NULL DEFAULT 0,
  clicked_product_id text,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_queries_query ON public.search_queries (query);
CREATE INDEX IF NOT EXISTS idx_search_queries_created ON public.search_queries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_product ON public.favorites (product_id);

GRANT SELECT, INSERT ON public.search_queries TO authenticated, anon;
GRANT ALL ON public.search_queries TO service_role;

-- WP11 Production preflight: remaining service-only table exposed without RLS.
-- Production execution requires explicit approval with the reviewed transaction.
ALTER TABLE public.comparison_diffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comparison_diffs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.comparison_diffs TO service_role;

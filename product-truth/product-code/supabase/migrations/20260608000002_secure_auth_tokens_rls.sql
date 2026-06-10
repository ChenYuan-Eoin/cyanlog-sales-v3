-- Migration: 20260608000002_secure_auth_tokens_rls.sql
-- PURPOSE:
-- 1. auth_tokens stores bearer-style session tokens and must not be readable from PostgREST public roles
-- 2. enable RLS to satisfy Supabase Advisor and block direct anon/authenticated access
-- 3. keep server-side service_role access unchanged

ALTER TABLE public.auth_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auth_tokens FROM anon;
REVOKE ALL ON TABLE public.auth_tokens FROM authenticated;

COMMENT ON TABLE public.auth_tokens IS 'Server-managed login session tokens. Direct client access is forbidden; service_role only.';

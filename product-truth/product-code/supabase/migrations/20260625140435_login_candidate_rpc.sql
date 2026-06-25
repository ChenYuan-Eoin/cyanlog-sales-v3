-- Combine login preflight reads into one service-role RPC.
-- Password verification and token creation stay in the API layer.

CREATE OR REPLACE FUNCTION public.get_login_candidate_v1(
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_ip_address text DEFAULT 'unknown',
  p_since timestamptz DEFAULT now() - interval '15 minutes',
  p_account_limit integer DEFAULT 5,
  p_ip_limit integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
WITH input AS (
  SELECT COALESCE(NULLIF(p_email, ''), NULLIF(p_phone, '')) AS identifier
),
account_failures AS (
  SELECT la.attempted_at
  FROM public.login_attempts AS la
  CROSS JOIN input
  WHERE input.identifier IS NOT NULL
    AND la.identifier = input.identifier
    AND la.success = false
    AND la.attempted_at >= p_since
  ORDER BY la.attempted_at DESC
  LIMIT p_account_limit
),
ip_failures AS (
  SELECT la.attempted_at
  FROM public.login_attempts AS la
  WHERE la.ip_address = p_ip_address
    AND la.success = false
    AND la.attempted_at >= p_since
  ORDER BY la.attempted_at DESC
  LIMIT p_ip_limit
),
candidate_user AS (
  SELECT
    u.id,
    u.email,
    u.phone,
    u.display_name,
    u.org_id,
    u.password_hash,
    u.must_change_password
  FROM public.users AS u
  WHERE (NULLIF(p_email, '') IS NOT NULL AND u.email = p_email)
     OR (NULLIF(p_phone, '') IS NOT NULL AND u.phone = p_phone)
  LIMIT 1
)
SELECT jsonb_build_object(
  'accountCount', (SELECT count(*) FROM account_failures),
  'accountOldestAttemptedAt', (SELECT attempted_at FROM account_failures ORDER BY attempted_at ASC LIMIT 1),
  'ipCount', (SELECT count(*) FROM ip_failures),
  'ipOldestAttemptedAt', (SELECT attempted_at FROM ip_failures ORDER BY attempted_at ASC LIMIT 1),
  'user', (SELECT to_jsonb(candidate_user) FROM candidate_user)
);
$$;

REVOKE EXECUTE ON FUNCTION public.get_login_candidate_v1(text, text, text, timestamptz, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_login_candidate_v1(text, text, text, timestamptz, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_login_candidate_v1(text, text, text, timestamptz, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_login_candidate_v1(text, text, text, timestamptz, integer, integer) TO service_role;

-- One-round-trip login for service-role API routes.
-- Keeps session persistence in auth_tokens while avoiding separate RPC + insert calls.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.login_with_password_v1(
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_password text DEFAULT NULL,
  p_ip_address text DEFAULT 'unknown',
  p_token_id uuid DEFAULT NULL,
  p_token text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL,
  p_since timestamptz DEFAULT now() - interval '15 minutes',
  p_account_limit integer DEFAULT 5,
  p_ip_limit integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  v_identifier text := COALESCE(NULLIF(p_email, ''), NULLIF(p_phone, ''));
  v_ip_address text := COALESCE(NULLIF(p_ip_address, ''), 'unknown');
  v_since timestamptz := COALESCE(p_since, now() - interval '15 minutes');
  v_account_limit integer := GREATEST(COALESCE(p_account_limit, 5), 1);
  v_ip_limit integer := GREATEST(COALESCE(p_ip_limit, 15), 1);
  v_lock_duration interval := interval '15 minutes';
  v_account_count integer := 0;
  v_ip_count integer := 0;
  v_account_oldest timestamptz;
  v_ip_oldest timestamptz;
  v_retry_after integer;
  v_user record;
  v_pg_bcrypt_hash text;
BEGIN
  IF v_identifier IS NULL
    OR NULLIF(p_password, '') IS NULL
    OR p_token_id IS NULL
    OR NULLIF(p_token, '') IS NULL
    OR p_expires_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTH_FAILED');
  END IF;

  WITH failures AS (
    SELECT la.attempted_at
    FROM public.login_attempts AS la
    WHERE la.identifier = v_identifier
      AND la.success = false
      AND la.attempted_at >= v_since
    ORDER BY la.attempted_at DESC
    LIMIT v_account_limit
  )
  SELECT count(*)::integer, min(attempted_at)
  INTO v_account_count, v_account_oldest
  FROM failures;

  WITH failures AS (
    SELECT la.attempted_at
    FROM public.login_attempts AS la
    WHERE la.ip_address = v_ip_address
      AND la.success = false
      AND la.attempted_at >= v_since
    ORDER BY la.attempted_at DESC
    LIMIT v_ip_limit
  )
  SELECT count(*)::integer, min(attempted_at)
  INTO v_ip_count, v_ip_oldest
  FROM failures;

  IF v_account_count >= v_account_limit THEN
    v_retry_after := COALESCE(
      GREATEST(
        0,
        CEIL(EXTRACT(EPOCH FROM (v_account_oldest + v_lock_duration - now())))::integer
      ),
      EXTRACT(EPOCH FROM v_lock_duration)::integer
    );

    RETURN jsonb_build_object(
      'ok', false,
      'code', 'account_locked',
      'retryAfterSeconds', v_retry_after
    );
  END IF;

  IF v_ip_count >= v_ip_limit THEN
    v_retry_after := COALESCE(
      GREATEST(
        0,
        CEIL(EXTRACT(EPOCH FROM (v_ip_oldest + v_lock_duration - now())))::integer
      ),
      EXTRACT(EPOCH FROM v_lock_duration)::integer
    );

    RETURN jsonb_build_object(
      'ok', false,
      'code', 'ip_locked',
      'retryAfterSeconds', v_retry_after
    );
  END IF;

  SELECT
    u.id,
    u.email,
    u.phone,
    u.display_name,
    u.org_id,
    u.password_hash,
    u.must_change_password
  INTO v_user
  FROM public.users AS u
  WHERE (NULLIF(p_email, '') IS NOT NULL AND u.email = p_email)
     OR (NULLIF(p_phone, '') IS NOT NULL AND u.phone = p_phone)
  LIMIT 1;

  IF v_user.id IS NULL THEN
    INSERT INTO public.login_attempts(identifier, ip_address, success)
    VALUES (v_identifier, v_ip_address, false);

    RETURN jsonb_build_object('ok', false, 'code', 'AUTH_FAILED');
  END IF;

  v_pg_bcrypt_hash := replace(replace(v_user.password_hash, '$2b$', '$2a$'), '$2y$', '$2a$');
  IF extensions.crypt(p_password, v_pg_bcrypt_hash) IS DISTINCT FROM v_pg_bcrypt_hash THEN
    INSERT INTO public.login_attempts(identifier, ip_address, success)
    VALUES (v_identifier, v_ip_address, false);

    RETURN jsonb_build_object('ok', false, 'code', 'AUTH_FAILED');
  END IF;

  INSERT INTO public.auth_tokens(id, token, user_id, expires_at)
  VALUES (p_token_id, p_token, v_user.id, p_expires_at);

  INSERT INTO public.login_attempts(identifier, ip_address, success)
  VALUES (v_identifier, v_ip_address, true);

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'OK',
    'user', jsonb_build_object(
      'id', v_user.id,
      'email', v_user.email,
      'phone', v_user.phone,
      'display_name', v_user.display_name,
      'org_id', v_user.org_id,
      'must_change_password', COALESCE(v_user.must_change_password, false)
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.login_with_password_v1(text, text, text, text, uuid, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.login_with_password_v1(text, text, text, text, uuid, text, timestamptz, timestamptz, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.login_with_password_v1(text, text, text, text, uuid, text, timestamptz, timestamptz, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.login_with_password_v1(text, text, text, text, uuid, text, timestamptz, timestamptz, integer, integer) TO service_role;

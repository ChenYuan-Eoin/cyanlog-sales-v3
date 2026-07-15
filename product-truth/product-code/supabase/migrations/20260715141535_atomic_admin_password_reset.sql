-- Atomically reset an organization user's password and revoke every existing
-- application session. Authorization is performed by the server route before
-- the service-role client invokes this function; public API roles cannot call it.

CREATE OR REPLACE FUNCTION public.reset_org_user_password_and_revoke_sessions_v1(
  p_target_user_id UUID,
  p_org_id UUID,
  p_password_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated_user_id UUID;
BEGIN
  IF p_password_hash IS NULL OR length(p_password_hash) = 0 THEN
    RAISE EXCEPTION 'password hash is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.users
  SET
    password_hash = p_password_hash,
    must_change_password = TRUE,
    updated_at = NOW()
  WHERE id = p_target_user_id
    AND org_id = p_org_id
  RETURNING id INTO v_updated_user_id;

  IF v_updated_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.auth_tokens
  WHERE user_id = p_target_user_id;

  RETURN TRUE;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.reset_org_user_password_and_revoke_sessions_v1(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.reset_org_user_password_and_revoke_sessions_v1(UUID, UUID, TEXT) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.reset_org_user_password_and_revoke_sessions_v1(UUID, UUID, TEXT) FROM authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.reset_org_user_password_and_revoke_sessions_v1(UUID, UUID, TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.reset_org_user_password_and_revoke_sessions_v1(UUID, UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.reset_org_user_password_and_revoke_sessions_v1(UUID, UUID, TEXT)
IS 'Service-role-only atomic password reset and application-session revocation for an exact organization user.';

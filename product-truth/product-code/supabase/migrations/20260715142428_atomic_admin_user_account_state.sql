-- Keep account-state changes and application-session revocation atomic. The
-- server route authorizes the actor; this function enforces the final tenant
-- boundary and protected-role check again inside the transaction.

CREATE OR REPLACE FUNCTION public.set_org_user_account_state_and_revoke_sessions_v1(
  p_target_user_id UUID,
  p_org_id UUID,
  p_status TEXT,
  p_login_enabled BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target_user_id UUID;
  v_updated_user_id UUID;
BEGIN
  IF p_status IS NULL AND p_login_enabled IS NULL THEN
    RAISE EXCEPTION 'at least one account state field is required' USING ERRCODE = '22023';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'inactive', 'suspended') THEN
    RAISE EXCEPTION 'invalid user status' USING ERRCODE = '22023';
  END IF;

  SELECT u.id
  INTO v_target_user_id
  FROM public.users AS u
  WHERE u.id = p_target_user_id
    AND u.org_id = p_org_id
  FOR UPDATE;

  IF v_target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles AS ur
    JOIN public.roles AS r ON r.id = ur.role_id
    WHERE ur.user_id = p_target_user_id
      AND ur.scope_type = 'org'
      AND ur.scope_id = p_org_id
      AND r.code = 'SUPER_ADMIN'
  ) THEN
    RAISE EXCEPTION 'protected super admin account' USING ERRCODE = '42501';
  END IF;

  UPDATE public.users AS u
  SET
    status = CASE WHEN p_status IS NULL THEN u.status ELSE p_status END,
    login_enabled = CASE
      WHEN p_login_enabled IS NULL THEN u.login_enabled
      ELSE p_login_enabled
    END,
    updated_at = NOW()
  WHERE u.id = p_target_user_id
    AND u.org_id = p_org_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_roles AS ur
      JOIN public.roles AS r ON r.id = ur.role_id
      WHERE ur.user_id = p_target_user_id
        AND ur.scope_type = 'org'
        AND ur.scope_id = p_org_id
        AND r.code = 'SUPER_ADMIN'
    )
  RETURNING u.id INTO v_updated_user_id;

  IF v_updated_user_id IS NULL THEN
    RAISE EXCEPTION 'protected super admin account' USING ERRCODE = '42501';
  END IF;

  -- Revoke on every account-state change, including re-enable/reactivate. Old
  -- bearer tokens must never become valid again when the account is reopened.
  DELETE FROM public.auth_tokens
  WHERE user_id = p_target_user_id;

  RETURN TRUE;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.set_org_user_account_state_and_revoke_sessions_v1(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.set_org_user_account_state_and_revoke_sessions_v1(UUID, UUID, TEXT, BOOLEAN) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.set_org_user_account_state_and_revoke_sessions_v1(UUID, UUID, TEXT, BOOLEAN) FROM authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.set_org_user_account_state_and_revoke_sessions_v1(UUID, UUID, TEXT, BOOLEAN) FROM service_role;
GRANT EXECUTE ON FUNCTION public.set_org_user_account_state_and_revoke_sessions_v1(UUID, UUID, TEXT, BOOLEAN) TO service_role;

COMMENT ON FUNCTION public.set_org_user_account_state_and_revoke_sessions_v1(UUID, UUID, TEXT, BOOLEAN)
IS 'Service-role-only exact-organization account-state update with atomic application-session revocation.';

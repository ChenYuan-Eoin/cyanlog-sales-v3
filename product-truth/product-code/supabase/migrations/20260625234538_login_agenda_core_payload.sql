-- Add upcoming agenda payload to the successful login RPC core cache bundle.
-- This keeps /schedule responsive immediately after login without adding a
-- second cold Data API round trip during the first page switch.

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
  v_role_codes text[] := ARRAY[]::text[];
  v_permissions text[] := ARRAY[]::text[];
  v_dashboard jsonb := NULL;
  v_core jsonb := NULL;
  v_can_manage_org boolean := false;
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

  SELECT
    COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), ARRAY[]::text[]),
    COALESCE(array_agg(DISTINCT permission.value) FILTER (WHERE permission.value IS NOT NULL), ARRAY[]::text[])
  INTO v_role_codes, v_permissions
  FROM public.user_roles AS ur
  JOIN public.roles AS r ON r.id = ur.role_id
  LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(r.permissions, '[]'::jsonb)) AS permission(value) ON true
  WHERE ur.user_id = v_user.id
    AND ur.scope_type = 'org';

  IF 'SUPER_ADMIN' = ANY(v_role_codes) AND NOT ('*' = ANY(v_permissions)) THEN
    v_permissions := array_append(v_permissions, '*');
  END IF;

  v_can_manage_org := 'SUPER_ADMIN' = ANY(v_role_codes)
    OR 'SALES_OPS' = ANY(v_role_codes)
    OR 'ADMIN' = ANY(v_role_codes)
    OR '*' = ANY(v_permissions)
    OR 'admin:access' = ANY(v_permissions)
    OR 'admin:*' = ANY(v_permissions)
    OR 'org:write' = ANY(v_permissions)
    OR 'org:*' = ANY(v_permissions)
    OR 'user:view' = ANY(v_permissions)
    OR 'user:write' = ANY(v_permissions)
    OR 'user:*' = ANY(v_permissions);

  INSERT INTO public.auth_tokens(id, token, user_id, expires_at)
  VALUES (p_token_id, p_token, v_user.id, p_expires_at);

  INSERT INTO public.login_attempts(identifier, ip_address, success)
  VALUES (v_identifier, v_ip_address, true);

  IF NOT COALESCE(v_user.must_change_password, false) THEN
    BEGIN
      SELECT public.get_dashboard_payload_v1(v_user.id, v_user.org_id, NULL)
      INTO v_dashboard;
    EXCEPTION WHEN OTHERS THEN
      v_dashboard := NULL;
    END;

    BEGIN
      WITH contract_rows AS (
        SELECT jsonb_build_object(
          'id', c.id,
          'filename', c.filename,
          'status', c.status,
          'created_at', c.created_at,
          'updated_at', c.updated_at
        ) AS value
        FROM public.contracts AS c
        WHERE c.org_id = v_user.org_id
        ORDER BY c.created_at DESC
        LIMIT 21
      ),
      contract_payload AS (
        SELECT
          COALESCE(
            (
              SELECT jsonb_agg(value)
              FROM (
                SELECT value
                FROM contract_rows
                LIMIT 20
              ) AS visible_contracts
            ),
            '[]'::jsonb
          ) AS contracts,
          count(*) > 20 AS has_next
        FROM contract_rows
      ),
      draft_payload AS (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', d.id,
              'title', d.title,
              'status', d.status,
              'updated_at', d.updated_at,
              'created_at', d.created_at
            )
            ORDER BY d.updated_at DESC
          ),
          '[]'::jsonb
        ) AS drafts
        FROM public.contract_drafts AS d
        WHERE d.org_id = v_user.org_id
          AND d.created_by = v_user.id
      ),
      product_payload AS (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', p.id,
              'code', p.code,
              'name', p.name,
              'specification', p.specification,
              'unit', p.unit,
              'base_price', p.base_price,
              'cost_price', p.cost_price,
              'min_price', p.min_price,
              'tier_pricing_enabled', COALESCE(p.tier_pricing_enabled, false),
              'status', p.status,
              'product_categories', CASE
                WHEN pc.name IS NULL THEN NULL
                ELSE jsonb_build_object('name', pc.name)
              END
            )
            ORDER BY p.created_at DESC
          ),
          '[]'::jsonb
        ) AS products
        FROM (
          SELECT *
          FROM public.products
          WHERE org_id = v_user.org_id
          ORDER BY created_at DESC
          LIMIT 50
        ) AS p
        LEFT JOIN public.product_categories AS pc ON pc.id = p.category_id
      ),
      quote_payload AS (
        SELECT CASE
          WHEN v_can_manage_org THEN COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', q.id,
                'quote_no', q.quote_no,
                'customer_name', q.customer_name,
                'status', q.status,
                'total_amount', q.total_amount,
                'created_at', q.created_at
              )
              ORDER BY q.created_at DESC
            ),
            '[]'::jsonb
          )
          ELSE NULL
        END AS quotes
        FROM (
          SELECT id, quote_no, customer_name, status, total_amount, created_at
          FROM public.quotes
          WHERE org_id = v_user.org_id
          ORDER BY created_at DESC
          LIMIT 20
        ) AS q
      ),
      tender_payload AS (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', t.id,
              'original_file', t.original_file,
              'key_info', t.key_info,
              'confidence', t.confidence,
              'status', t.status,
              'created_at', t.created_at
            )
            ORDER BY t.created_at DESC
          ),
          '[]'::jsonb
        ) AS tenders
        FROM (
          SELECT id, original_file, key_info, confidence, status, created_at
          FROM public.ocr_results
          ORDER BY created_at DESC
          LIMIT 50
        ) AS t
      ),
      agenda_payload AS (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', a.id,
              'title', a.title,
              'description', a.description,
              'agenda_type', a.agenda_type,
              'start_at', a.start_at,
              'end_at', a.end_at,
              'all_day', COALESCE(a.all_day, false),
              'status', a.status,
              'priority', a.priority,
              'related_type', a.related_type,
              'related_id', a.related_id,
              'assignee_id', a.assignee_id,
              'created_by', a.created_by,
              'created_at', a.created_at,
              'updated_at', a.updated_at
            )
            ORDER BY a.start_at ASC
          ),
          '[]'::jsonb
        ) AS items
        FROM (
          SELECT
            id,
            title,
            description,
            agenda_type,
            start_at,
            end_at,
            all_day,
            status,
            priority,
            related_type,
            related_id,
            assignee_id,
            created_by,
            created_at,
            updated_at
          FROM public.agenda_items
          WHERE start_at >= now()
            AND (
              user_id = v_user.id
              OR assignee_id = v_user.id
              OR created_by = v_user.id
            )
          ORDER BY start_at ASC
          LIMIT 50
        ) AS a
      )
      SELECT jsonb_build_object(
        'contracts', jsonb_build_object(
          'contracts', cp.contracts,
          'drafts', dp.drafts,
          'meta', jsonb_build_object(
            'totalPages', CASE WHEN cp.has_next THEN 2 ELSE 1 END,
            'hasNext', cp.has_next,
            'hasPrev', false
          )
        ),
        'configs', jsonb_build_object('products', pp.products),
        'quotes', CASE
          WHEN qp.quotes IS NULL THEN NULL
          ELSE jsonb_build_object('quotes', qp.quotes)
        END,
        'tenders', jsonb_build_object('tenders', tp.tenders),
        'agenda', jsonb_build_object('items', ap.items)
      )
      INTO v_core
      FROM contract_payload AS cp
      CROSS JOIN draft_payload AS dp
      CROSS JOIN product_payload AS pp
      CROSS JOIN quote_payload AS qp
      CROSS JOIN tender_payload AS tp
      CROSS JOIN agenda_payload AS ap;
    EXCEPTION WHEN OTHERS THEN
      v_core := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'OK',
    'roleCodes', to_jsonb(v_role_codes),
    'allPermissions', to_jsonb(v_permissions),
    'dashboard', v_dashboard,
    'core', v_core,
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

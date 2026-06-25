-- Fix remote DB lint warnings introduced by RPC migrations.

CREATE OR REPLACE FUNCTION public.get_dashboard_payload_v1(
  p_user_id uuid,
  p_org_id uuid DEFAULT NULL,
  p_requested_space_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_role_codes text[] := ARRAY[]::text[];
  v_permissions text[] := ARRAY[]::text[];
  v_can_manage_org boolean := false;
  v_active_space_id uuid;
  v_payload jsonb;
BEGIN
  SELECT COALESCE(
    p_org_id,
    (
      SELECT uo.org_id
      FROM public.user_organizations uo
      WHERE uo.user_id = p_user_id
        AND uo.is_default = true
      LIMIT 1
    ),
    (
      SELECT u.org_id
      FROM public.users u
      WHERE u.id = p_user_id
      LIMIT 1
    )
  )
  INTO v_org_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'spaces', '[]'::jsonb,
      'activeSpace', NULL,
      'opportunities', '[]'::jsonb,
      'milestones', '[]'::jsonb,
      'reminders', '[]'::jsonb,
      'agenda', '[]'::jsonb
    );
  END IF;

  WITH role_rows AS (
    SELECT
      ur.scope_type,
      r.code,
      COALESCE(r.permissions, '[]'::jsonb) AS permissions
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
  )
  SELECT
    COALESCE(array_agg(DISTINCT code) FILTER (WHERE scope_type = 'org'), ARRAY[]::text[]),
    COALESCE(
      (
        SELECT array_agg(DISTINCT permission)
        FROM role_rows rr
        CROSS JOIN LATERAL jsonb_array_elements_text(rr.permissions) AS permission
        WHERE rr.scope_type = 'org'
      ),
      ARRAY[]::text[]
    )
  INTO v_role_codes, v_permissions
  FROM role_rows;

  v_can_manage_org := (
    v_role_codes && ARRAY['SUPER_ADMIN', 'SALES_OPS', 'ADMIN']::text[]
    OR v_permissions && ARRAY['*', 'admin:access', 'admin:*', 'org:write', 'org:*', 'user:view', 'user:write', 'user:*']::text[]
  );

  WITH role_rows AS (
    SELECT ur.scope_type, ur.scope_id
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
  ),
  department_scope AS (
    SELECT DISTINCT d.id
    FROM public.departments d
    JOIN role_rows rr
      ON rr.scope_type = 'department'
     AND rr.scope_id IS NOT NULL
     AND (
       d.id = rr.scope_id
       OR d.path LIKE ('%/' || rr.scope_id::text || '/%')
     )
    WHERE d.org_id = v_org_id
  ),
  accessible_spaces AS (
    SELECT DISTINCT
      s.id,
      s.name,
      s.description,
      s.department_id,
      s.owner_id,
      COALESCE(s.active_opportunities, 0) AS active_opportunities,
      COALESCE(s.pending_milestones, 0) AS pending_milestones
    FROM public.sales_spaces s
    WHERE s.org_id = v_org_id
      AND (
        v_can_manage_org
        OR EXISTS (
          SELECT 1
          FROM public.sales_space_members sm
          WHERE sm.space_id = s.id
            AND sm.user_id = p_user_id
        )
        OR EXISTS (
          SELECT 1
          FROM role_rows rr
          WHERE rr.scope_type = 'space'
            AND rr.scope_id = s.id
        )
        OR s.department_id IN (SELECT id FROM department_scope)
      )
  )
  SELECT s.id
  INTO v_active_space_id
  FROM accessible_spaces s
  ORDER BY (s.id = p_requested_space_id) DESC, s.name ASC
  LIMIT 1;

  WITH role_rows AS (
    SELECT ur.scope_type, ur.scope_id
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
  ),
  department_scope AS (
    SELECT DISTINCT d.id
    FROM public.departments d
    JOIN role_rows rr
      ON rr.scope_type = 'department'
     AND rr.scope_id IS NOT NULL
     AND (
       d.id = rr.scope_id
       OR d.path LIKE ('%/' || rr.scope_id::text || '/%')
     )
    WHERE d.org_id = v_org_id
  ),
  spaces AS (
    SELECT DISTINCT
      s.id,
      s.name,
      s.description,
      s.department_id,
      s.owner_id,
      COALESCE(s.active_opportunities, 0) AS active_opportunities,
      COALESCE(s.pending_milestones, 0) AS pending_milestones
    FROM public.sales_spaces s
    WHERE s.org_id = v_org_id
      AND (
        v_can_manage_org
        OR EXISTS (
          SELECT 1
          FROM public.sales_space_members sm
          WHERE sm.space_id = s.id
            AND sm.user_id = p_user_id
        )
        OR EXISTS (
          SELECT 1
          FROM role_rows rr
          WHERE rr.scope_type = 'space'
            AND rr.scope_id = s.id
        )
        OR s.department_id IN (SELECT id FROM department_scope)
      )
  ),
  active_space AS (
    SELECT *
    FROM spaces
    WHERE id = v_active_space_id
  ),
  opportunities_payload AS (
    SELECT
      o.id,
      o.space_id,
      o.customer_id,
      o.name,
      o.amount,
      o.status,
      o.stage,
      o.probability,
      o.owner_id,
      o.expected_close_date,
      CASE
        WHEN c.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'short_name', c.short_name
        )
      END AS customer
    FROM public.opportunities o
    LEFT JOIN public.customers c ON c.id = o.customer_id
    WHERE v_active_space_id IS NOT NULL
      AND o.space_id = v_active_space_id
    ORDER BY o.expected_close_date ASC NULLS LAST
    LIMIT 20
  ),
  milestones_payload AS (
    SELECT
      m.id,
      m.opportunity_id,
      m.name,
      m.type,
      m.status,
      m.priority,
      m.due_date,
      jsonb_build_object(
        'name', o.name,
        'customer_id', o.customer_id
      ) AS opportunity
    FROM public.milestones m
    JOIN opportunities_payload o ON o.id = m.opportunity_id
    WHERE m.status IN ('PENDING', 'IN_PROGRESS')
      AND m.due_date <= now() + interval '7 days'
    ORDER BY m.due_date ASC
    LIMIT 10
  ),
  reminders_payload AS (
    SELECT
      r.id,
      r.type,
      r.title,
      r.description,
      r.priority,
      r.read_at
    FROM public.reminders r
    WHERE r.user_id = p_user_id
      AND r.dismissed_at IS NULL
    ORDER BY r.created_at DESC
    LIMIT 5
  ),
  agenda_payload AS (
    SELECT
      a.id,
      a.title,
      a.description,
      COALESCE(a.start_at, a.start_time) AS start_time,
      COALESCE(a.end_at, a.end_time) AS end_time
    FROM public.agenda_items a
    WHERE a.agenda_date = current_date
      AND (
        a.user_id = p_user_id
        OR a.assignee_id = p_user_id
        OR a.created_by = p_user_id
      )
    ORDER BY a.start_at ASC NULLS LAST
    LIMIT 6
  )
  SELECT jsonb_build_object(
    'spaces', COALESCE((SELECT jsonb_agg(to_jsonb(sp) ORDER BY sp.name) FROM spaces sp), '[]'::jsonb),
    'activeSpace', (SELECT to_jsonb(a) FROM active_space a LIMIT 1),
    'opportunities', COALESCE((SELECT jsonb_agg(to_jsonb(o)) FROM opportunities_payload o), '[]'::jsonb),
    'milestones', COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM milestones_payload m), '[]'::jsonb),
    'reminders', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM reminders_payload r), '[]'::jsonb),
    'agenda', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM agenda_payload a), '[]'::jsonb)
  )
  INTO v_payload;

  RETURN v_payload;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_dashboard_payload_v1(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_payload_v1(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_payload_v1(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_payload_v1(uuid, uuid, uuid) TO service_role;

CREATE SEQUENCE IF NOT EXISTS public.quote_number_seq START 1000;

CREATE OR REPLACE FUNCTION public.generate_quote_number()
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  seq_num integer;
  date_str text;
  result text;
  attempts integer := 0;
  max_attempts integer := 3;
BEGIN
  LOOP
    attempts := attempts + 1;

    seq_num := nextval('public.quote_number_seq');
    date_str := to_char(current_date, 'YYYYMMDD');
    result := 'QT-' || date_str || '-' || lpad(seq_num::text, 4, '0');

    IF NOT EXISTS (SELECT 1 FROM public.quotes WHERE quote_no = result) THEN
      RETURN result;
    END IF;

    IF attempts >= max_attempts THEN
      result := result || '-' || substr(gen_random_uuid()::text, 1, 4);
      RETURN result;
    END IF;

    PERFORM pg_sleep(0.01);
  END LOOP;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_quote_number() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_quote_number() FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_quote_number() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.generate_quote_number() TO service_role;

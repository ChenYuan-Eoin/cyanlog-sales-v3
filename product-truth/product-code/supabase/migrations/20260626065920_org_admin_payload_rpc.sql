-- Aggregate the organization-admin payload in Postgres so /api/admin/org does
-- not need to fan out into many Supabase Data API requests.

CREATE OR REPLACE FUNCTION public.get_org_admin_payload_v1(
  p_org_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
WITH department_rows AS (
  SELECT
    d.id,
    d.name,
    d.code,
    COALESCE(d.depth, 0) AS depth,
    COALESCE(d.member_count, 0) AS member_count,
    d.parent_id,
    parent.name AS parent_name,
    d.leader_id,
    leader.display_name AS leader_name,
    COALESCE(d.sort_order, 0) AS sort_order
  FROM departments d
  LEFT JOIN departments parent ON parent.id = d.parent_id
  LEFT JOIN users leader ON leader.id = d.leader_id
  WHERE d.org_id = p_org_id
),
space_rows AS (
  SELECT
    s.id,
    s.name,
    s.description,
    s.department_id,
    d.name AS department_name,
    s.owner_id
  FROM sales_spaces s
  LEFT JOIN departments d ON d.id = s.department_id
  WHERE s.org_id = p_org_id
),
org_user_ids AS (
  SELECT uo.user_id AS id
  FROM user_organizations uo
  WHERE uo.org_id = p_org_id
  UNION
  SELECT u.id
  FROM users u
  WHERE u.org_id = p_org_id
),
user_rows AS (
  SELECT
    u.id,
    u.email,
    u.display_name,
    u.title,
    u.status,
    u.must_change_password,
    u.primary_dept_id,
    u.login_enabled,
    u.report_to_user_id,
    u.created_at,
    pd.name AS primary_dept_name,
    manager.display_name AS report_to_user_name
  FROM users u
  JOIN org_user_ids oui ON oui.id = u.id
  LEFT JOIN departments pd ON pd.id = u.primary_dept_id
  LEFT JOIN users manager ON manager.id = u.report_to_user_id
),
current_role_rows AS (
  SELECT
    ur.user_id,
    ur.scope_type,
    ur.scope_id,
    ur.granted_at,
    r.id AS role_id,
    r.name AS role_name,
    r.code AS role_code,
    COALESCE(r.sort_order, 0) AS sort_order,
    CASE
      WHEN ur.scope_type = 'department' THEN COALESCE(d.name, '部门')
      WHEN ur.scope_type = 'space' THEN COALESCE(s.name, '销售空间')
      ELSE '组织'
    END AS scope_name
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  LEFT JOIN departments d
    ON ur.scope_type = 'department'
   AND d.id = ur.scope_id
   AND d.org_id = p_org_id
  LEFT JOIN sales_spaces s
    ON ur.scope_type = 'space'
   AND s.id = ur.scope_id
   AND s.org_id = p_org_id
  WHERE ur.user_id IN (SELECT id FROM org_user_ids)
    AND (
      (ur.scope_type = 'org' AND (ur.scope_id IS NULL OR ur.scope_id = p_org_id))
      OR (ur.scope_type = 'department' AND d.id IS NOT NULL)
      OR (ur.scope_type = 'space' AND s.id IS NOT NULL)
    )
),
role_payload AS (
  SELECT
    crr.user_id,
    COALESCE(
      string_agg(
        CASE
          WHEN crr.scope_type = 'org' THEN crr.role_name
          ELSE crr.role_name || '(' || crr.scope_name || ')'
        END,
        ', '
        ORDER BY crr.sort_order, crr.role_name, crr.scope_name
      ),
      ''
    ) AS role_names,
    COALESCE(
      jsonb_agg(crr.role_id ORDER BY crr.sort_order, crr.role_name)
        FILTER (WHERE crr.scope_type = 'org'),
      '[]'::jsonb
    ) AS role_ids,
    COALESCE(
      jsonb_agg(crr.role_code ORDER BY crr.sort_order, crr.role_name)
        FILTER (WHERE crr.scope_type = 'org'),
      '[]'::jsonb
    ) AS role_codes,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'roleId', crr.role_id,
          'roleName', crr.role_name,
          'roleCode', crr.role_code,
          'scopeType', crr.scope_type,
          'scopeId', crr.scope_id,
          'scopeName', crr.scope_name,
          'grantedAt', crr.granted_at
        )
        ORDER BY crr.sort_order, crr.role_name, crr.scope_name
      ),
      '[]'::jsonb
    ) AS scoped_roles
  FROM current_role_rows crr
  GROUP BY crr.user_id
)
SELECT jsonb_build_object(
  'organization',
  (
    SELECT jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'slug', o.slug
    )
    FROM organizations o
    WHERE o.id = p_org_id
    LIMIT 1
  ),
  'users',
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', u.id,
          'email', COALESCE(u.email, ''),
          'display_name', u.display_name,
          'title', COALESCE(u.title, ''),
          'primary_dept_id', u.primary_dept_id,
          'primary_dept_name', COALESCE(u.primary_dept_name, '-'),
          'role_names', COALESCE(rp.role_names, ''),
          'role_ids', COALESCE(rp.role_ids, '[]'::jsonb),
          'role_codes', COALESCE(rp.role_codes, '[]'::jsonb),
          'scoped_roles', COALESCE(rp.scoped_roles, '[]'::jsonb),
          'status', u.status,
          'must_change_password', COALESCE(u.must_change_password, false),
          'login_enabled', COALESCE(u.login_enabled, true),
          'report_to_user_id', u.report_to_user_id,
          'report_to_user_name', u.report_to_user_name
        )
        ORDER BY u.created_at DESC NULLS LAST
      )
      FROM user_rows u
      LEFT JOIN role_payload rp ON rp.user_id = u.id
    ),
    '[]'::jsonb
  ),
  'departments',
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'name', d.name,
          'code', d.code,
          'depth', d.depth,
          'member_count', d.member_count,
          'parent_id', d.parent_id,
          'parent_name', d.parent_name,
          'leader_id', d.leader_id,
          'leader_name', d.leader_name
        )
        ORDER BY d.depth, d.sort_order, d.name
      )
      FROM department_rows d
    ),
    '[]'::jsonb
  ),
  'roles',
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'code', r.code,
          'name', r.name
        )
        ORDER BY COALESCE(r.sort_order, 0), r.name
      )
      FROM roles r
    ),
    '[]'::jsonb
  ),
  'spaces',
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'description', s.description,
          'department_id', s.department_id,
          'department_name', COALESCE(s.department_name, ''),
          'owner_id', s.owner_id
        )
        ORDER BY s.name
      )
      FROM space_rows s
    ),
    '[]'::jsonb
  )
);
$$;

REVOKE EXECUTE ON FUNCTION public.get_org_admin_payload_v1(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_org_admin_payload_v1(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_org_admin_payload_v1(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_admin_payload_v1(uuid) TO service_role;

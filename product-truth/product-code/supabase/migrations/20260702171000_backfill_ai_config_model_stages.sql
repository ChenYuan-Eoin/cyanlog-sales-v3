-- Backfill existing F012 AI_CONFIG rows with explicit runtime stage metadata.
-- This does not write or rotate credentials; users still configure api_key in Config Center.

update configs
set
  value = coalesce(value, '{}'::jsonb)
    || jsonb_build_object(
      'profile', 'local_primary',
      'provider_kind', 'openai_compatible',
      'stages', jsonb_build_array('semantic_review', 'comment_patch_draft', 'report_summary'),
      'routing', coalesce(value->'routing', '{}'::jsonb)
        || jsonb_build_object('max_pages', 15, 'strategy', 'full')
    ),
  updated_at = now()
where type = 'AI_CONFIG'
  and key = 'AI_LEVEL_1';

update configs
set
  value = coalesce(value, '{}'::jsonb)
    || jsonb_build_object(
      'profile', 'sales_cloud_backup',
      'provider_kind', 'openai_compatible',
      'stages', jsonb_build_array(
        'semantic_review',
        'tender_long_document_parse',
        'comment_patch_draft',
        'report_summary'
      ),
      'routing', coalesce(value->'routing', '{}'::jsonb)
        || jsonb_build_object(
          'max_pages',
          case
            when value #>> '{routing,max_pages}' ~ '^[0-9]+$'
              then greatest((value #>> '{routing,max_pages}')::int, 80)
            else 80
          end,
          'strategy', 'chunked'
        )
    ),
  updated_at = now()
where type = 'AI_CONFIG'
  and key = 'AI_LEVEL_2';

update configs
set
  value = coalesce(value, '{}'::jsonb)
    || jsonb_build_object(
      'profile', 'rule_engine',
      'provider_kind', 'builtin',
      'stages', jsonb_build_array('structured_rules', 'rule_fallback'),
      'routing', coalesce(value->'routing', '{}'::jsonb)
        || jsonb_build_object('max_pages', 999, 'strategy', 'rule')
    ),
  updated_at = now()
where type = 'AI_CONFIG'
  and key = 'AI_LEVEL_3';

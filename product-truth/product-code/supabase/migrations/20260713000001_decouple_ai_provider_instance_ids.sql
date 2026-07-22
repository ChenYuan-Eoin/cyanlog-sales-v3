-- Migration: AI Provider 稳定实例 ID 与 L1/L2/L3 配置对象键解耦
-- Date: 2026-07-13
-- PURPOSE: 工具策略引用模型实例，不再把 AI_LEVEL_1/2/3 当作模型身份。
-- NOTE: 保留 configs.key 作为历史配置对象键，避免破坏版本和审计记录。

update configs
set value = jsonb_set(
  value,
  '{instance_id}',
  to_jsonb(
    coalesce(
      nullif(value->>'instance_id', ''),
      nullif(value->>'profile', ''),
      case key
        when 'AI_LEVEL_1' then 'local_primary'
        when 'AI_LEVEL_2' then 'sales_cloud_backup'
        when 'AI_LEVEL_3' then 'rule_engine'
        else lower(key)
      end
    )
  ),
  true
)
where type = 'AI_CONFIG'
  and coalesce(value->>'kind', 'provider') = 'provider';

-- 历史 L1/L2/L3 配置缺少 Provider 语义，编辑页不能只靠模型名推断。
update configs
set value = jsonb_set(
  jsonb_set(
    jsonb_set(value, '{kind}', to_jsonb('provider'::text), true),
    '{provider_kind}',
    to_jsonb(
      case key
        when 'AI_LEVEL_1' then 'lm_studio'
        when 'AI_LEVEL_2' then 'openai_compatible'
        when 'AI_LEVEL_3' then 'rule_engine'
      end
    ),
    true
  ),
  '{api_format}',
  to_jsonb(
    case key
      when 'AI_LEVEL_1' then coalesce(value->>'api_format', 'openai_compatible')
      when 'AI_LEVEL_2' then coalesce(value->>'api_format', 'openai_compatible')
      when 'AI_LEVEL_3' then 'builtin'
    end
  ),
  true
)
where type = 'AI_CONFIG'
  and key in ('AI_LEVEL_1', 'AI_LEVEL_2', 'AI_LEVEL_3');

update configs
set value = jsonb_set(
  value,
  '{provider_chain}',
  coalesce((
    select jsonb_agg(
      case reference
        when 'AI_LEVEL_1' then to_jsonb('local_primary'::text)
        when 'AI_LEVEL_2' then to_jsonb('sales_cloud_backup'::text)
        when 'AI_LEVEL_3' then to_jsonb('rule_engine'::text)
        else to_jsonb(reference)
      end
    )
    from jsonb_array_elements_text(value->'provider_chain') as refs(reference)
  ), '[]'::jsonb),
  true
)
where type = 'AI_CONFIG'
  and value->>'kind' = 'tool_policy'
  and jsonb_typeof(value->'provider_chain') = 'array';

update configs
set value = jsonb_set(
  value,
  '{fallback_chain}',
  coalesce((
    select jsonb_agg(
      case reference
        when 'AI_LEVEL_1' then to_jsonb('local_primary'::text)
        when 'AI_LEVEL_2' then to_jsonb('sales_cloud_backup'::text)
        when 'AI_LEVEL_3' then to_jsonb('rule_engine'::text)
        else to_jsonb(reference)
      end
    )
    from jsonb_array_elements_text(value->'fallback_chain') as refs(reference)
  ), '[]'::jsonb),
  true
)
where type = 'AI_CONFIG'
  and jsonb_typeof(value->'fallback_chain') = 'array';

-- Migration: 运行时 UI 主题配置默认值
-- Date: 2026-06-04
-- PURPOSE: 为每个组织注入默认主题配置，支持不发版调整按钮/输入框/卡片等基础样式

insert into configs (key, name, value, type, status, description, org_id)
select
  'UI_THEME_DEFAULT',
  '默认界面主题',
  jsonb_build_object(
    'primary', '#2563eb',
    'primaryForeground', '#ffffff',
    'secondary', '#eff6ff',
    'secondaryForeground', '#0f172a',
    'background', '#eef3f8',
    'foreground', '#0f172a',
    'card', '#ffffff',
    'cardForeground', '#0f172a',
    'popover', '#ffffff',
    'popoverForeground', '#0f172a',
    'muted', '#f8fafc',
    'mutedForeground', '#64748b',
    'border', '#dbe4ee',
    'input', '#ffffff',
    'ring', '#60a5fa',
    'destructive', '#dc2626',
    'destructiveForeground', '#ffffff',
    'radiusMd', 10,
    'radiusLg', 16
  ),
  'UI_THEME'::config_type,
  'PUBLISHED'::config_status,
  '运行时主题变量，适用于按钮、输入框、卡片等基础组件',
  org.id
from organizations org
on conflict (key, org_id) do nothing;

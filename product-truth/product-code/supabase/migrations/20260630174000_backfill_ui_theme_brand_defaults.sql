-- Migration: 补齐运行时主题品牌默认值
-- Date: 2026-06-30
-- PURPOSE: 已有 UI_THEME 记录可能只包含色板字段，导致品牌管理表单和首屏回退到旧品牌或空值。
--          本迁移只填补缺失字段，不覆盖租户已配置的品牌、标题、图标或颜色。

update configs
set value = jsonb_build_object(
    'brandName', 'ONES Sales',
    'brandShortName', 'OS',
    'productTitle', 'ONES Sales',
    'productSubtitle', '智能协作平台',
    'loginTitle', '企业协作支撑平台',
    'loginSubtitle', '使用企业账号进入工作台首页',
    'brandAssets', jsonb_build_object(
      'fullLogo', jsonb_build_object('light', '', 'dark', ''),
      'symbol', jsonb_build_object('light', '', 'dark', ''),
      'favicon', ''
    ),
    'appearance', 'system'
  ) || coalesce(value, '{}'::jsonb)
where type = 'UI_THEME'::config_type
  and (
    value is null
    or not (value ? 'brandName')
    or not (value ? 'brandShortName')
    or not (value ? 'productTitle')
    or not (value ? 'productSubtitle')
    or not (value ? 'loginTitle')
    or not (value ? 'loginSubtitle')
    or not (value ? 'brandAssets')
    or not (value ? 'appearance')
  );

-- Migration: 运行时 UI 主题配置（类型扩展）
-- Date: 2026-06-04
-- PURPOSE: 为运行时主题配置增加 UI_THEME 枚举值

alter type config_type add value if not exists 'UI_THEME';

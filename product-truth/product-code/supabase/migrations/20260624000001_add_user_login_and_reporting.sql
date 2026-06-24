-- Migration: 添加用户登录控制和汇报对象字段
-- Date: 2026-06-24
-- REQ: F011 - 人员列表行内操作
-- PURPOSE: 支持"允许/禁止登录"和"修改汇报对象"功能

alter table users
  add column if not exists login_enabled boolean not null default true;

alter table users
  add column if not exists report_to_user_id uuid references users(id) on delete set null;

-- 更新 schema-check.ts 中的 users 字段列表
-- ponytail: login_enabled 默认值 true 保证向后兼容；report_to_user_id 自引用支持汇报链

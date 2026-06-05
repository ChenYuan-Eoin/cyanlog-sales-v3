-- Migration: 首次登录强制改密
-- Date: 2026-06-05
-- PURPOSE: 管理员下发临时密码后，用户首次登录必须修改密码

alter table users
  add column if not exists must_change_password boolean not null default false;

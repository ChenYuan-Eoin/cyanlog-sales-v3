-- Migration: 20260622000002_add_contracts_storage_bucket.sql
-- PURPOSE: 创建 contracts storage bucket 用于合同文件存储

-- 启用 storage 扩展（如果不存在）
create extension if not exists "supabase_storage" schema storage;

-- 创建 bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contracts',
  'contracts',
  false,
  10485760, -- 10MB
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do nothing;

-- 设置 bucket 的 RLS 策略
-- 允许认证用户上传文件
insert into storage.policies (name, bucket_id, operation, definition)
values (
  'Allow authenticated users to upload',
  'contracts',
  'INSERT',
  '(select auth.role() = ''authenticated'')'
)
on conflict do nothing;

-- 允许用户读取自己的文件
insert into storage.policies (name, bucket_id, operation, definition)
values (
  'Allow users to read their own files',
  'contracts',
  'SELECT',
  '(select auth.role() = ''authenticated'')'
)
on conflict do nothing;

-- 允许用户删除自己的文件
insert into storage.policies (name, bucket_id, operation, definition)
values (
  'Allow users to delete their own files',
  'contracts',
  'DELETE',
  '(bucket_id = ''contracts'' and auth.uid() = owner)'
)
on conflict do nothing;

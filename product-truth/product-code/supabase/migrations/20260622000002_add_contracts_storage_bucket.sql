-- Migration: 20260622000002_add_contracts_storage_bucket.sql
-- PURPOSE: Create private buckets used by contract upload and chunk merge.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'contracts',
    'contracts',
    false,
    10485760,
    array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png'
    ]
  ),
  (
    'contract-chunks',
    'contract-chunks',
    false,
    5242880,
    null
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "contract buckets read" on storage.objects;
create policy "contract buckets read" on storage.objects
  for select to authenticated
  using (bucket_id in ('contracts', 'contract-chunks'));

drop policy if exists "contract buckets insert" on storage.objects;
create policy "contract buckets insert" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('contracts', 'contract-chunks'));

drop policy if exists "contract buckets update" on storage.objects;
create policy "contract buckets update" on storage.objects
  for update to authenticated
  using (bucket_id in ('contracts', 'contract-chunks'))
  with check (bucket_id in ('contracts', 'contract-chunks'));

drop policy if exists "contract buckets delete" on storage.objects;
create policy "contract buckets delete" on storage.objects
  for delete to authenticated
  using (bucket_id in ('contracts', 'contract-chunks'));

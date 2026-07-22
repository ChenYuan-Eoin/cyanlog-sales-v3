-- G5 Storage gate: contract files are server-mediated and fail closed to
-- Supabase anon/authenticated clients.  The application uses its own auth
-- token and service_role-backed API routes, so browser Storage policies are
-- both unused and unsafe.

set lock_timeout = '5s';
set statement_timeout = '60s';

do $$
begin
  if not exists (
    select 1 from storage.buckets where id = 'contracts'
  ) then
    raise exception 'required storage bucket contracts is missing';
  end if;

  if not exists (
    select 1 from storage.buckets where id = 'contract-chunks'
  ) then
    raise exception 'required storage bucket contract-chunks is missing';
  end if;
end;
$$;

-- Supabase Free has a 50 MB global file ceiling.  Keep the product claim
-- honest rather than introducing a recurring paid-plan dependency.
update storage.buckets
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-word.document.macroEnabled.12'
    ]::text[]
where id = 'contracts';

-- Vercel Functions accept at most 4.5 MB request bodies.  Four-megabyte
-- chunks leave room for multipart framing and are merged only by the trusted
-- server route.
update storage.buckets
set public = false,
    file_size_limit = 4194304,
    allowed_mime_types = null
where id = 'contract-chunks';

drop policy if exists "contract buckets insert" on storage.objects;
drop policy if exists "contract buckets read" on storage.objects;
drop policy if exists "contract buckets update" on storage.objects;
drop policy if exists "contract buckets delete" on storage.objects;

do $$
declare
  contract_bucket storage.buckets%rowtype;
  chunk_bucket storage.buckets%rowtype;
begin
  select * into strict contract_bucket
  from storage.buckets
  where id = 'contracts';

  if contract_bucket.public
     or contract_bucket.file_size_limit is distinct from 52428800
     or cardinality(contract_bucket.allowed_mime_types) is distinct from 4
     or not contract_bucket.allowed_mime_types @> array[
       'application/pdf',
       'application/msword',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.ms-word.document.macroEnabled.12'
     ]::text[] then
    raise exception 'contracts bucket postcondition failed';
  end if;

  select * into strict chunk_bucket
  from storage.buckets
  where id = 'contract-chunks';

  if chunk_bucket.public
     or chunk_bucket.file_size_limit is distinct from 4194304
     or chunk_bucket.allowed_mime_types is not null then
    raise exception 'contract-chunks bucket postcondition failed';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        policyname in (
          'contract buckets insert',
          'contract buckets read',
          'contract buckets update',
          'contract buckets delete'
        )
        or position(
          'contract-chunks' in coalesce(qual, '') || ' ' || coalesce(with_check, '')
        ) > 0
        or position(
          '''contracts''' in coalesce(qual, '') || ' ' || coalesce(with_check, '')
        ) > 0
      )
      and (
        roles @> array['public']::name[]
        or roles @> array['anon']::name[]
        or roles @> array['authenticated']::name[]
      )
  ) then
    raise exception 'contract storage still has a direct client policy';
  end if;
end;
$$;

reset statement_timeout;
reset lock_timeout;


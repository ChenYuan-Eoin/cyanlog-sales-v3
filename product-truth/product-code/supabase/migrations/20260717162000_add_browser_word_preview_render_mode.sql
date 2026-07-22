begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.contract_source_page_maps
  drop constraint if exists contract_source_page_maps_render_mode_check;

alter table public.contract_source_page_maps
  add constraint contract_source_page_maps_render_mode_check
  check (render_mode in (
    'native-pdf',
    'docx-to-pdf',
    'word-to-pdf',
    'browser-ooxml',
    'identity-only'
  ));

comment on column public.contract_source_page_maps.render_mode is
  'Audited preview path: native PDF, historical server Word conversion, browser OOXML, or identity-only legacy DOC.';

commit;

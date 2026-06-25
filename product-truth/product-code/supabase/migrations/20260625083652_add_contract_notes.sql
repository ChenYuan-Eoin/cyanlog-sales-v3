alter table contracts
  add column if not exists notes text;

comment on column contracts.notes is '合同备注，用于新建/编辑合同草稿时保存补充说明';

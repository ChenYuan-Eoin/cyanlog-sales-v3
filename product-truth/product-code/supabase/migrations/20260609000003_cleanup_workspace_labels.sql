-- PURPOSE: 清理生产中不合适的“作战/战报”命名，收敛为空间/简报口径

do $$
begin
  if to_regclass('public.sales_spaces') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'sales_spaces'
         and column_name = 'name'
     )
  then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'sales_spaces'
        and column_name = 'updated_at'
    ) then
      update sales_spaces
      set
        name = replace(name, '销售作战空间', '销售空间'),
        updated_at = now()
      where name like '%销售作战空间%';
    else
      update sales_spaces
      set name = replace(name, '销售作战空间', '销售空间')
      where name like '%销售作战空间%';
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.reminders') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'reminders'
         and column_name = 'title'
     )
  then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'reminders'
        and column_name = 'updated_at'
    ) then
      update reminders
      set
        title = replace(title, '战报', '简报'),
        updated_at = now()
      where title like '%战报%';
    else
      update reminders
      set title = replace(title, '战报', '简报')
      where title like '%战报%';
    end if;
  end if;
end $$;

-- PURPOSE: 清理生产中不合适的“作战/战报”命名，收敛为空间/简报口径

update sales_spaces
set
  name = replace(name, '销售作战空间', '销售空间'),
  updated_at = now()
where name like '%销售作战空间%';

update reminders
set
  title = replace(title, '战报', '简报'),
  updated_at = now()
where title like '%战报%';

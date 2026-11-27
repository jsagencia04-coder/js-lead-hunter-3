-- Permissões (ACL) de tabelas, views, sequências e funções dos esquemas public e backup_*,
-- e os privilégios padrão. Usado por 01/05 (origem) e 03 (VPS): as duas listas têm de ser iguais.
-- Saída: esquema <TAB> objeto <TAB> tipo <TAB> acl
select n.nspname, c.relname, c.relkind::text, coalesce((select string_agg(a::text, ',' order by a::text) from unnest(c.relacl) a), '(padrão)')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where (n.nspname = 'public' or n.nspname like 'backup\_%')
   and c.relkind in ('r', 'p', 'v', 'm', 'S')
union all
select n.nspname, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', 'f',
       coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '(padrão)')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')  -- ignora funções de extensões
union all
select coalesce(n.nspname, '(todos)'), pg_get_userbyid(d.defaclrole), 'padrão:' || d.defaclobjtype::text,
       (select string_agg(a::text, ',' order by a::text) from unnest(d.defaclacl) a)
  from pg_default_acl d
  left join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname = 'public' and pg_get_userbyid(d.defaclrole) = 'postgres'
 order by 1, 2, 3;

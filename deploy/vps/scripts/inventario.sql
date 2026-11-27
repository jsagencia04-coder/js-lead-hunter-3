-- Quantidade EXATA de linhas por tabela (esquemas public e backup_*, e as tabelas de login copiadas).
-- Saída: esquema <TAB> tabela <TAB> linhas, em ordem. Usado por 01 (nuvem) e 03 (VPS) para comparar.
select t.table_schema,
       t.table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I', t.table_schema, t.table_name),
                           false, true, '')))[1]::text::bigint as linhas
  from information_schema.tables t
 where t.table_type = 'BASE TABLE'
   and (t.table_schema = 'public'
        or t.table_schema like 'backup\_%'
        or (t.table_schema = 'auth' and t.table_name in ('users', 'identities')))
 order by 1, 2;

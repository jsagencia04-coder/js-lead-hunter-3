# Reversão da entrega Minha Operação

## Frontend

Registrar o destino anterior de `/srv/js-lead-hunter/www-versoes/atual` **antes** de publicar. Em falha crítica, criar um link temporário relativo para essa versão anterior e substituí-lo com `mv -Tf` no mesmo diretório/filesystem. O container jslh-web lê esse link. Reverter também o link `/srv/js-lead-hunter/www` para a mesma versão. Não apagar pastas de versões em uso.

Não interromper banco, Auth ou outros projetos para reverter apenas o frontend.

## Banco

A migration 016 cria somente `public.my_operation_summary()`. O frontend anterior não a utiliza: **deixar a função no banco ao reverter a interface é a opção de menor risco**. Não é necessário restaurar dados nem executar rollback de tabelas.

Se houver necessidade comprovada de remover a função, auditar chamadas e dependências e executar a remoção controlada após voltar a interface anterior. Não usar CASCADE. Não apagar o registro em app_migrations automaticamente: isso precisa fazer parte de uma correção futura explícita para manter histórico coerente.

Em Postgres descartável foram testados DROP/CREATE da função dentro de transação, comparando contagem de leads antes/depois e revertendo a transação. Isso não equivale a restauração validada do backup completo de produção.

## Critérios

Erros de login/consulta que antes funcionavam, exibição de carteira de outro usuário, erro de assets ou indisponibilidade após publicação exigem interromper a promoção, preservar logs sem segredos e voltar à versão anterior. Só declarar resolvido após repetir verificações HTTPS, autenticação e consultas reais autorizadas.

# Próxima publicação — Minha Operação (migration 016)

## Pré-condições

- Acesso SSH por chave autorizado ou sessão gerenciada na VPS. Não usar senha literal em comandos, arquivos do repositório ou logs.
- Checkout remoto em `feature/js-lead-hunter-v3`, sem alterações locais desconhecidas. Preservar mudanças locais; não executar `git reset --hard`.
- Serviços e dados atuais preservados. A migration 016 apenas cria função; não apaga/altera tabelas ou linhas.
- Testes locais e CI aprovados. A release integrada V3 continua pendente (ver controle-de-entregas.md).

## Ordem de execução (na VPS)

1. Registrar commit remoto, link `www-versoes/atual`, estado dos containers e contagens do banco. Verificar capacidade e erros ativos.
2. Atualizar somente a branch autorizada com `git fetch` e `git merge --ff-only origin/feature/js-lead-hunter-v3`. Revisar `git status` antes; o `web/tsconfig.tsbuildinfo` é cache gerado, mas diferenças desconhecidas não devem ser descartadas.
3. Construir **nova imagem do serviço migrate** com o código atualizado. O `docker compose run migrate` sem rebuild pode executar uma imagem antiga que não contém a migration 016.
4. Aplicar `migrate` na rede interna do banco com env existente no servidor. Não imprimir credenciais. Confirmar `app_migrations.version = 20261127000016` e existência de `public.my_operation_summary()`.
5. Notificar PostgREST para recarregar o schema (`NOTIFY pgrst, 'reload schema'`).
6. Executar `deploy/vps/scripts/04-publicar-frontend.sh`. O script executa instalação limpa, testes e build antes de trocar os links; grava `release.json` com commit e horário.
7. Conferir HTTPS **sem desabilitar validação do certificado**, `release.json` e os assets publicados. Confirmar que o commit corresponde ao checkout.
8. Homologar com usuário autorizado: login, Minha Operação, empresa, alternância de abas, rascunhos e logout. Não alterar senha de usuário existente para testar. Nenhum fixture sintético deve ser inserido em produção.
9. Confirmar contagens preservadas, workers sem reinícios/erros novos e demais projetos da VPS intactos.

Não executar resets de ensaio, restaurar dumps sobre o banco vivo ou encerrar serviços de outros projetos. Não ligar APIs pagas/chaves adiadas pelo usuário.

# Controle de entregas V3 — execução incremental

## Situação real

A release integrada **v3.0.0 não está concluída nem homologada**. As entregas abaixo são incrementais. Os testes automatizados locais não substituem homologação autenticada em produção.

| Entrega | Código | Publicação/validação |
|---|---|---|
| Correção do backup no Windows | ef7a94b | Testada localmente; não presumir imagem remota atualizada |
| Menu recolhível (3 grupos com páginas existentes) | b1b66bd | Publicado; HTTP 200 confirmado anteriormente |
| Skeletons e estados vazios no dashboard | 4ab963b | Publicado; build remoto aprovado anteriormente |
| Ficha organizada em 5 abas existentes | 8e116dc | Publicado; login público observado; fluxo autenticado não homologado |
| Minha Operação + função SQL 016 | Alterações desta entrega | Validada localmente; **não publicada**, acesso SSH seguro indisponível |
| Preservação de rascunhos nas abas, teclado/ARIA | Alterações desta entrega | 12 testes frontend no conjunto da entrega; **não publicada** |
| Dependências corrigidas e testes frontend no CI | Alterações desta entrega | npm audit: zero vulnerabilidades localmente; **não publicada** |
| Publicação com lock, testes, release.json e troca atômica | Alterações desta entrega | bash -n aprovado; **não executada na VPS** |

## Evidências desta entrega (27/11/2026)

- `supabase/tests/run.sh`: 140 verificações SQL, incluindo 18 específicas de Minha Operação.
- Testes de banco: carteiras distintas para dois usuários, RLS de usuário inativo, privilégio anônimo negado, bloqueio de contato, totais maiores que listas, responsável da oportunidade e fuso de São Paulo.
- Rollback/recriação da função em transação no Postgres descartável: mesma contagem de leads antes/depois; transação revertida.
- `npm ci`, `npm test`: 12 testes aprovados (abas, rascunhos, teclado, menu/roles, navegação, erros e totais de Minha Operação).
- `npm run build`: aprovado. Aviso de chunk maior que 500 kB continua pendente de otimização.
- `npm audit --audit-level=moderate`: zero vulnerabilidades após atualização de Vite, Vitest e React Router.
- Teste antigo com timeout e pipeline de shell gerou saída incompleta (`FF`); não é evidência de aprovação. Corrigidos o marcador da migration 016 e os testes com contagem fixa de 15 migrations. Regressão completa reexecutada sem mascarar o código de saída: **56/56 testes do worker aprovados em 124,84 s**.
- Site publicado anteriormente: HTTPS 200 confirmado sem ignorar o certificado; esta entrega nova não foi enviada à VPS.

## Impedimento de deploy

A política de execução recusou senha SSH literal na linha de comando. A tentativa com `ssh -o BatchMode=yes` confirmou que nenhuma chave utilizável está autorizada. Não foram alteradas as senhas dos usuários da aplicação nem criadas contas de teste em produção.

É necessário configurar autenticação SSH segura (chave ou conexão gerenciada). A autorização do usuário para deploy automático permanece válida, mas não substitui esse requisito de acesso. A versão publicada anteriormente não foi substituída por esta entrega.

## Escopo ainda não entregue da missão

| Área | Classificação honesta |
|---|---|
| Design System completo, tema claro/escuro, notificações e acessibilidade integral | Parcialmente operacional (menu/skeleton/abas; restante não implementado) |
| Dashboard executivo completo, todos os filtros e indicadores pedidos | Parcialmente operacional (métricas anteriores preservadas) |
| Base de empresas 3.0 integral | Parcialmente operacional (pesquisa/paginação anteriores preservadas) |
| Ficha 360° de 14 abas e timeline consolidada completa | Parcialmente operacional (5 abas; demais submódulos não implementados) |
| DNA digital e auditoria passiva | Implementação anterior preservada; provedores Google/Brave bloqueados por chaves adiadas pelo usuário |
| DOS, Commercial Fit e Data Confidence separados, configuráveis | Não implementados integralmente; score legado não equivale aos três indicadores |
| Radar, watchlists, timing e benchmarking competitivo | Não implementados nesta missão |
| Market Gap e Opportunity Graph | Mapa anterior preservado; expansão não implementada |
| Minha Operação | Implementada e validada localmente; bloqueada para publicação |
| CRM completo, múltiplos funis, calendário e todos os recursos novos | Parcialmente operacional (CRM anterior preservado) |
| Automações comerciais e tarefas recorrentes | Não implementadas nesta missão |
| Propostas PDF/versionamento e Customer Success completo | Registros anteriores preservados; expansão não implementada |
| Catálogo inteligente e verticais configuráveis | Catálogo anterior preservado; expansão não implementada |
| Central de 12 agentes, copiloto e aprendizado comercial | Não implementados nesta missão |
| Campanhas, relatórios completos, custos, integrações e administração V3 | Módulos anteriores preservados; expansão não implementada |
| Importação/filas existentes | Preservadas; nova importação real completa ainda não comprovada nesta execução |
| Segurança, backup/restauração e performance de produção | Testes locais parciais; auditoria/homologação integral pendente |
| Release v3.0.0 | Não preparada/publicada: critérios globais de aceite não satisfeitos |

O adiamento de chaves e backup externo não autoriza perda de dados nem transforma integrações em operacionais. Serviços públicos de pesquisa/Receita são dependências externas de dados; self-hosting do banco não significa operação totalmente offline.

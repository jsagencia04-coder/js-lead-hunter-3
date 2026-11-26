# JS Lead Hunter

> **Cópia de trabalho do JS Lead Hunter 3.0.** O sistema em produção continua no repositório
> original [`js-lead-hunter`](https://github.com/jsagencia04-coder/js-lead-hunter). Aqui os
> agendamentos do GitHub Actions estão desligados e só rodam manualmente com a variável
> `PERMITIR_WORKER=sim`. Use apenas o banco de **homologação**; nunca cadastre o `DATABASE_URL` de produção.

Plataforma de inteligência comercial da **JS Designer**. Ela encontra empresas brasileiras recém-abertas e com situação cadastral **ATIVA** na base pública do CNPJ da Receita Federal e as transforma em leads pontuados, com recomendação de serviços e um CRM para acompanhar a prospecção.

> A base pública do CNPJ é atualizada **por competência** (mensalmente), não em tempo real. O sistema mostra sempre a competência vigente e a data de referência dos dados. Situação cadastral ativa **não** comprova regularidade fiscal.

## JS Lead Hunter 2.0 — módulos

| Menu | O que faz |
|---|---|
| Visão geral | Indicadores **comerciais** (qualificados, contatados, respostas, reuniões, propostas, valor em negociação, receita contratada e recorrente, ticket médio, tempo médio de fechamento, conversão, follow-ups atrasados) separados dos **cadastrais** e da inteligência digital. Cada taxa mostra o denominador. |
| Base de empresas | Pesquisa avançada da base da Receita (16 filtros, exportação). |
| Mapa de oportunidades | Estados e municípios por volume e prioridade. |
| Inteligência digital | Fila de pesquisa, resultados por canal, uso e custo por provedor, pausa/retomada, limites e orçamento. |
| Central de oportunidades | Filtros prontos (sem site, sem Instagram, sem Facebook, site com problemas, sem Perfil no Google, recém-abertas, alta prioridade, diagnóstico pendente) + CNAE, UF, município, porte e serviço; agrupamentos com contagem no servidor; segmentos salvos; seleção em lote para adicionar ao CRM, distribuir em rodízio ou pesquisar de novo. |
| CRM comercial | **Oportunidades** (separadas da empresa) em Kanban ou tabela, 12 etapas configuráveis, motivos de perda, reativação, várias oportunidades por empresa. |
| Agenda e tarefas | Ligações, reuniões, e-mails, WhatsApp, visitas, follow-ups e pós-venda; atrasadas, hoje e próximas; contador de atrasos no menu. |
| Propostas | Todas as propostas, situação, validade e valores. |
| Clientes | Contratos, receita contratada e recorrente mensal. |
| Serviços | Catálogo da JS Designer com preços, pacotes, recorrência, condições e regras de recomendação por evidência digital. |
| Relatórios | Metas individuais e da equipe; desempenho por responsável, serviço, segmento e região (exporta CSV). |

**Ficha da empresa:** assistente comercial (diagnóstico, resumo, serviço recomendado com preço, canal e abordagem sugeridos, sugestão de proposta, próxima ação e follow-up), oportunidades, tarefas, presença digital com evidências e confirmação/correção manual, mensagem sugerida (envio sempre manual, uma por vez), propostas, contratos, tags e histórico completo.

### Motor de inteligência digital

Processo separado da importação: `python -m lead_hunter intel` (workflow *Inteligência digital*, ou serviço `intel` no Docker).

- **Fontes autorizadas:** domínio do e-mail cadastral (grátis), Google Places API (Perfil da Empresa no Google, site e telefone) e Brave Search API (site, Instagram, Facebook, LinkedIn). Instagram e Facebook nunca são acessados diretamente: vêm de links publicados no site oficial ou de resultados da pesquisa. Nada de raspagem, CAPTCHA ou evasão de bloqueios.
- **Identidade:** índice de confiança 0–100 por canal, somando evidências (CNPJ na página +60, domínio igual ao do e-mail +40, telefone +30, nome +15/+25, município +15, logradouro e CEP +10) e descontando divergências (nome diferente −25, outro município −30). Verificado ≥ 70, possível ≥ 40 (configurável). Homônimos de outra cidade não são associados.
- **Status por canal:** pendente, em processamento, encontrado e verificado, possível correspondência, não localizado, inconclusivo, erro temporário. **"Não localizado" só com pesquisa conclusiva** daquele canal; falha de conexão, bloqueio, provedor sem chave ou limite atingido nunca viram ausência.
- **Auditoria do site (passiva):** disponibilidade, HTTPS, redirecionamentos, tempo de resposta, responsividade (viewport), SEO básico, contatos (telefone, e-mail, WhatsApp, formulário), até 8 links internos quebrados, domínio estacionado e rodapé desatualizado, com nota e evidências.
- **Proteção SSRF:** só http/https nas portas 80/443, todos os IPs resolvidos precisam ser públicos, redirecionamentos validados um a um (máx. 5), IP real conferido após a conexão (DNS rebinding) e corpo limitado a 1,5 MB.
- **Fila:** prioridade (recém-abertas, maior pontuação, leads em atendimento), lotes com concorrência, `SKIP LOCKED` entre workers, batimento e recuperação de itens presos, retentativa com espera exponencial (10 min → 24 h, até 6 tentativas), cache de consultas (30 dias), limites diários e orçamento por provedor (`provider_usage`), checkpoint e histórico de cada rodada (`enrichment_runs`), pausa e retomada pela interface, reverificação periódica (verificado 90 dias, inconclusivo 7…). Confirmações manuais nunca são sobrescritas. Se o banco passar de 95% do `DB_SIZE_LIMIT_MB`, o motor para.

### Pontuação 2.0 (versionada e explicável)

| Critério | Pontos | Regra |
|---|---|---|
| Oportunidade digital | 40 | só com evidência conclusiva: site não localizado após pesquisa (100%), domínio estacionado (90%), problemas técnicos graves (60%), Instagram não localizado com site verificado (40%), melhorias leves (30%) |
| Compatibilidade com serviços | 25 | maior relevância entre as regras de CNAE |
| Potencial do segmento | 15 | serviços da JS Designer aplicáveis ao CNAE (3 ou mais = integral) |
| Recência | 10 | integral até 30 dias, metade até 90 |
| Canais de contato | 10 | telefone 30%, e-mail 20%, canal digital verificado 50% |

Cada lead guarda os pontos por critério, o **motivo** de cada um (`score_reasons`), a **versão das regras** (`scoring_versions`, nova versão a cada alteração de pesos, regras de CNAE ou serviços) e, separado do score, o **índice de confiança do diagnóstico**. Os pesos antigos (telefone, e-mail, porte) continuam editáveis em *Administração*.

## Arquitetura

```
 Receita Federal (WebDAV público, ZIPs por competência)
              │  download em partes, retomável
              ▼
 Worker Python (VPS / Docker) ── DuckDB lê Latin-1 · Polars valida ── R2/S3 (opcional)
              │  carga em UMA transação (idempotente)
              ▼
 Supabase: PostgreSQL + Auth + RLS + Edge Function
              ▲
              │  chave anon + login (RLS em todas as tabelas)
 Frontend React + TypeScript + Tailwind (Vercel, Netlify, Cloudflare Pages ou a própria VPS)
```

| Pasta | Conteúdo |
|---|---|
| `supabase/migrations/` | Estrutura, segurança (RLS e auditoria), configuração comercial, pontuação, CRM, preservação, inteligência digital (001–015, todas aditivas a partir da 011) |
| `supabase/functions/invite-user/` | Convite de usuários (a `service_role` fica só no servidor) |
| `supabase/tests/` | Testes SQL de segurança e regras de negócio |
| `worker/` | Worker de importação (Python, DuckDB, Polars), motor de inteligência digital (`lead_hunter/intel`), backup e testes |
| `web/` | Interface |
| `.github/workflows/ci.yml` | Roda todos os testes a cada envio ao GitHub |
| `.github/workflows/worker.yml` | Importação + migrations + manutenção (agendado) |
| `.github/workflows/inteligencia.yml` | Inteligência digital (agendado, processo separado) |

## Funcionalidades

- **Dashboard comercial:** leads novos na competência, alta prioridade, qualificados, contatados, respostas recebidas, propostas enviadas e aceitas, valor proposto, clientes convertidos, taxa de conversão, follow-ups atrasados, desempenho por serviço e por responsável.
- **Dashboard da base:** empresas encontradas e ativas, abertas nos últimos 7, 15, 30 e 90 dias, com telefone e com e-mail, além dos leads de alta prioridade, contatados e convertidos. Inclui gráficos por UF, município, CNAE, porte e mês de abertura, e mostra a competência vigente e o estado da coleta.
- **Mapa do Brasil:** os 27 estados coloridos por volume. Ao clicar num estado, aparecem os indicadores dele, a seleção de município e os leads com maior pontuação, além do botão para voltar à visão nacional.
- **Pesquisa avançada:** todos os 16 filtros pedidos, paginação no servidor, pesquisas salvas (próprias ou compartilhadas) e exportação para Excel (CSV com `;` e UTF-8 com BOM).
- **Inteligência comercial:** pontuação de 0 a 100 (alta de 70 a 100, média de 40 a 69, baixa de 0 a 39), com o detalhamento por critério. As recomendações de serviço seguem o CNAE, e pesos e regras são editáveis, com botão para recalcular todos os leads.
- **CRM:** Kanban com as 10 etapas e arrastar e soltar. A ficha do lead traz dados cadastrais, recomendações, responsável, anotações, registro de contatos (telefone, WhatsApp, e-mail, presencial) e de **respostas recebidas**, agendamento e conclusão de follow-up, bloqueio para contato e o histórico completo, gravado automaticamente.
- **Diagnóstico comercial individual:** oportunidades com recomendação e motivo verificável (ex.: domínio próprio sem site, empresa recém-aberta, segmento do CNAE) e ressalvas quando a verificação é inconclusiva. Nunca afirma ausência de site sem prova.
- **Propostas e negociação:** registro de propostas com valor, validade e situação (rascunho, enviada, em negociação, aceita, recusada, expirada). Enviar ou negociar avança a etapa do lead (nunca retrocede).
- **Abordagem sugerida:** modelos por serviço e segmento, preenchidos com os dados do lead. O usuário revisa e envia **manualmente, uma mensagem por vez** (WhatsApp ou e-mail); não há disparo em massa. Empresas bloqueadas não recebem sugestão.
- **Central de importação:** competência vigente, estado do worker e das integrações, histórico de execuções (arquivos, registros lidos, novos leads, atualizações, erros, duração) com log detalhado, e botões para verificar nova competência e iniciar importação.
- **Administração:** usuários e perfis (admin, gestor, comercial, leitura), convites, oposição ao contato, serviços, pesos de pontuação, regras por CNAE e auditoria.

## Pontuação e presença digital

**Pesos padrão.** Foram recalibrados com os dados reais: telefone, e-mail e recência estão presentes em ~100% das empresas novas e quase não diferenciam leads. Todos os pesos são editáveis em *Administração → Serviços e pontuação*.

| Critério | Pontos |
|---|---|
| Compatibilidade do CNAE com os serviços da JS Designer | 35 |
| Oportunidade digital **verificada** | 30 |
| Recência da abertura | 15 |
| Porte | 10 |
| Telefone | 5 |
| E-mail | 5 |

**Regras por CNAE.** Há 70 regras iniciais por divisão ou subclasse (varejo, alimentação, saúde, construção, serviços profissionais etc.). Elas definem tanto a compatibilidade quanto os serviços recomendados e também são editáveis.

**Presença digital.** O worker verifica o domínio do e-mail cadastral de cada lead:

- **Não pontuam:**
  - e-mail genérico (Gmail, Hotmail etc.);
  - domínio usado por várias empresas ou de escritório de contabilidade (é o contador, não a empresa);
  - servidor que recusa o acesso (403/429/5xx), demora ou não responde. Esse caso fica "inconclusivo" e é reverificado em 7 dias.
- **Pontuam como oportunidade:**
  - domínio próprio que **não existe no DNS** (prova de que não há site nesse domínio);
  - página vazia ou estacionada.
- **Site no ar:** preenche o campo *Site*.

A verificação acessa só a página inicial pública do domínio da própria empresa.

**Espaço no banco.** Com `DB_SIZE_LIMIT_MB` (500 no workflow, o limite do Supabase gratuito), o worker estima o espaço antes de gravar. Se a carga não couber, ele não grava nem apaga nada e avisa na Central de importação. Depois de contratar o plano Pro, crie a variável `DB_SIZE_LIMIT_MB=8000` no GitHub.

## Preservação dos dados (JS Lead Hunter 2.0)

- **Nada é excluído por idade.** O arquivamento automático está **desligado** (migration 012); a janela de captação (`LEAD_WINDOW_DAYS`) só decide quais empresas *novas* viram leads. Um administrador pode religar o arquivamento em *Administração → Arquivamento*, e ele só alcança leads sem nenhuma ação comercial.
- **Sem espaço no banco:** a importação para antes de gravar, não apaga nada e mostra o aviso na *Central de importação*.
- **Atualização cadastral pelo CNPJ:** a reimportação atualiza os dados mantendo o mesmo lead (id, etapa, responsável, histórico). Cada mudança cadastral (telefone, endereço, situação, CNAE…) fica registrada em `registry_changes`, com valor anterior e novo.
- **Leads arquivados podem voltar.** Em *Administração → Arquivamento*: busque e clique em *Restaurar* (ou *Restaurar todos*). Na próxima importação o worker relê o cadastro completo da empresa nos arquivos oficiais da Receita e recria o lead com origem "restaurado". Empresas bloqueadas para contato não voltam. Para não esperar a próxima competência, use *Iniciar importação* (reimporta a competência vigente, sem duplicar).
- **O que o arquivo guarda:** CNPJ, razão social, nome fantasia, UF, município, CNAE, data de abertura, telefone, e-mail, site, pontuação, prioridade, competência, datas e motivo. Endereço completo, porte, capital social, Simples/MEI e recomendações voltam pela restauração.
- **Inventário:** no início e no fim de cada rodada o worker registra as quantidades de empresas, leads, arquivados, contatos, propostas, bloqueios etc. (`data_inventory_snapshots`), e a *Central de importação* compara os dois últimos retratos. Se algo diminuir, o log da rodada mostra um aviso. Só totais vão para o log; nenhum dado de empresa.
- **Backup verificável:** `python -m lead_hunter backup` (no Windows: `worker\windows\6-fazer-backup.bat`) gera uma pasta com um CSV compactado por tabela e um manifesto com a quantidade de linhas e o SHA-256 de cada arquivo, tirado num único instante (transação somente leitura) e conferido ao final. `backup-verify PASTA` confere de novo; `restore-test PASTA URL` restaura num banco **vazio** de teste e compara tabela por tabela (recusa bancos com dados). O backup tem dados pessoais: guarde em local protegido e **nunca** envie ao GitHub (a pasta `backups/` está no `.gitignore`).
- **Antes de cada migration**, o `migrate` copia os dados comerciais (perfis, leads trabalhados, histórico, propostas, bloqueios, regras) para um esquema `backup_AAAAMMDDHHMM_pre_<versão>` no próprio banco.

## Regras de identificação de leads

Um lead é criado automaticamente quando o estabelecimento atende a todas estas condições:

1. o CNPJ é válido, com DV conferido, inclusive no formato **alfanumérico** de julho de 2026;
2. a situação cadastral é **02 (ativa)**;
3. é a **matriz** (filiais podem entrar com `INCLUDE_BRANCHES=true`);
4. a data de início de atividade é válida e está dentro da janela (`LEAD_WINDOW_DAYS`, padrão 90 dias);
5. a empresa **não** está bloqueada para contato;
6. a empresa ainda **não** tem lead (CNPJ básico único no CRM);
7. a empresa **não** está no arquivo de leads (arquivar não faz o lead voltar como novo).

Não são importados CPFs nem nomes de sócios.

---

## 1. Banco e autenticação (Supabase)

1. Crie um projeto em [supabase.com](https://supabase.com), na região **São Paulo (sa-east-1)**.
2. Em *Authentication → Sign In / Providers → Email*, **desative “Allow new users to sign up”**. O acesso é só por convite.
3. Aplique as migrations **em ordem**, de uma destas formas:
   - CLI: `supabase link --project-ref SEU_REF` e depois `supabase db push`;
   - ou cole cada arquivo de `supabase/migrations/` no *SQL Editor*, do `...001` ao `...004`.
4. Convide o primeiro usuário em *Authentication → Users → Invite user*. **O primeiro usuário vira Administrador automaticamente.**
5. Implante a função de convite: `supabase functions deploy invite-user`.
6. Em *Authentication → URL Configuration*, informe a URL do site e adicione `https://SEU-SITE/redefinir-senha` às *Redirect URLs*.

**Plano do Supabase:** o plano gratuito tem 500 MB de banco. Com a janela padrão de 90 dias, a base operacional tende a passar disso, porque o Brasil abre milhões de CNPJs por ano. Para testar no plano gratuito, use `LEAD_WINDOW_DAYS=15` ou `30`. Para produção, o plano Pro (8 GB, backups diários) é o indicado.

## 2. Frontend

```bash
cd web
cp .env.example .env.local     # VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (chave anon/pública)
npm install
npm run dev                    # http://localhost:5173
```

Para publicar e testar sem servidor próprio, importe o repositório no **Vercel** ou no **Netlify** com estas configurações:

- diretório raiz `web`;
- comando de build `npm run build`;
- pasta de saída `dist`;
- as duas variáveis `VITE_*`;
- todas as rotas redirecionadas para `/index.html` (SPA). No Netlify basta um arquivo `_redirects` com `/* /index.html 200`.

## 3. Worker de importação

O worker faz o trabalho pesado:

- descobre a competência mais recente **completa** no servidor da Receita;
- baixa cerca de 7 GB de ZIPs em partes, com retomada;
- lê e filtra os arquivos;
- grava no banco **numa única transação**: se algo falhar, a importação anterior continua valendo;
- cria os leads com pontuação e recomendações.

Ele atende os botões da Central de importação e verifica sozinho, a cada 12 horas, se há competência nova.

### Rodar no GitHub Actions (sem servidor; modo atual)

O workflow `.github/workflows/worker.yml` roda a cada hora. Em cada execução ele:

- aplica as migrations pendentes (`python -m lead_hunter migrate`);
- atende os pedidos feitos na Central de importação;
- verifica se há competência nova e importa.

O download continua de onde parou entre uma execução e outra. O teste a partir do GitHub baixou da Receita a cerca de 0,58 MB/s por conexão, ou seja, ~7 GB em menos de 1 hora com 8 conexões. Repositório público não tem limite de minutos.

Configuração em *Settings → Secrets and variables → Actions*:

| Tipo | Nome | Valor |
|---|---|---|
| Secret | `DATABASE_URL` | `postgresql://postgres.<ref>:<SENHA>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres` |
| Variable (opcional) | `LEAD_WINDOW_DAYS` | padrão `7` (Supabase gratuito tem 500 MB); com o plano Pro use `90` |

Para rodar na hora: aba *Actions → Worker de importação → Run workflow*. Atenção: o GitHub desativa workflows agendados após 60 dias sem commits no repositório; se isso acontecer, reative na aba *Actions*.

### Rodar no Windows (atalhos prontos)

Na pasta `worker/windows/` há arquivos `.bat` numerados: `1-instalar`, `2-verificar-receita`, `3-iniciar-worker`, `4-importar-agora` e `5-iniciar-com-o-windows`. Veja o `LEIA-ME.txt` da pasta.

### Rodar na sua máquina (linha de comando)

```bash
cd worker
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                   # preencha DATABASE_URL
export $(grep -v '^#' .env | xargs)                    # ou defina as variáveis manualmente
export DATA_DIR=./data

python -m lead_hunter check      # mostra a competência disponível na Receita
python -m lead_hunter import     # importa agora (pode levar horas: o servidor da Receita é lento)
python -m lead_hunter run        # modo contínuo, atendendo a interface
```

`DATABASE_URL` vem de *Project Settings → Database → Connection string*. Use a opção **Session pooler** (porta 5432) ou a conexão direta. **Não** use o *Transaction pooler* (porta 6543). Essa credencial é de administrador do banco: fica **somente** no servidor do worker, nunca no frontend nem no GitHub.

### Rodar com Docker (produção)

```bash
cp worker/.env.example worker/.env      # preencha
docker compose up -d --build
docker compose logs -f worker
```

### Se o servidor da Receita estiver fora do ar ou bloquear o IP

1. Baixe os ZIPs da competência manualmente para `DATA_DIR/manual/AAAA-MM/`.
2. Use `RF_MODE=local` e `RF_LOCAL_DIR=/data/manual`.

O endereço da fonte também pode ser trocado por `RF_BASE_URL` sem mexer no código.

## 4. Testes

```bash
# Banco: aplica todas as migrations num Postgres limpo e valida RLS e regras (29 verificações)
PGHOST=localhost PGUSER=postgres ./supabase/tests/run.sh

# Worker: unitários + ponta a ponta com servidor WebDAV falso e arquivos sintéticos no leiaute oficial
cd worker && pip install -r requirements-dev.txt
TEST_DATABASE_URL=postgresql://postgres:senha@localhost:5432/postgres python -m pytest -v

# Frontend
cd web && npm run build
```

Os arquivos usados nos testes são **sintéticos** e existem só durante o teste. O GitHub Actions roda tudo isso a cada envio.

O teste ponta a ponta do worker cobre:

- Latin-1, `;` dentro de aspas e CNPJ alfanumérico;
- empresa baixada, DV inválido, filial e empresa fora da janela;
- empresa bloqueada para contato;
- reimportação sem duplicar;
- atualização de situação cadastral;
- ZIP corrompido que **não** substitui a importação válida;
- download em partes com falhas simuladas.

## 5. Hospedagem (quando estiver 100%)

**Situação em 25/11/2026:** banco no Supabase gratuito (≈447 MB de 500 MB, **sem backups automáticos**), worker no GitHub Actions de um repositório **público** e frontend no Netlify. Recomendações, em ordem:

1. **Supabase Pro** (backups diários, 8 GB) e `DB_SIZE_LIMIT_MB=8000`. Sem isso, cada competência nova força arquivamento e não há como restaurar dados.
2. **Worker na VPS** (Docker, abaixo), tirando o `DATABASE_URL` dos Secrets do GitHub: o segredo de administrador do banco deixa de depender de um repositório público, e a verificação de sites deixa de vir de IPs do GitHub (que muitos sites bloqueiam: ~90% das verificações recentes ficaram inconclusivas). Depois, desative o workflow *Worker de importação*.
3. Se o código continuar no GitHub, torne o repositório **privado**.

| Componente | Recomendação |
|---|---|
| Banco + Auth | Supabase Pro (região São Paulo), com backups diários. Ative o PITR se precisar restaurar para um ponto exato. |
| Frontend | Vercel, Netlify ou Cloudflare Pages (o plano gratuito atende) ou Nginx na mesma VPS. |
| Worker | VPS Linux com Docker: **4 vCPU, 8 GB RAM e 40 GB SSD**. O worker baixa e processa um ZIP por vez, lendo em blocos (pico de ~3 GB); com mais espaço, guarda os ZIPs até o fim para retomar mais rápido. Hostinger, Contabo, DigitalOcean, Hetzner e Magalu Cloud servem. |
| Armazenamento (opcional) | Cloudflare R2 com as variáveis `S3_*`: guarda os ZIPs da competência para reprocessar sem baixar de novo. |

O worker só precisa de saída para a internet (Receita e Supabase). Nenhuma porta precisa ficar aberta.

## Segurança
- **Cadastro só por convite:** quem se cadastra sozinho entra **inativo** e não lê nada até um administrador ativar. Convites pela Edge Function já entram ativos.
- **Campos calculados protegidos:** pontuação, presença digital e origem do lead só mudam pelo worker ou por administrador.
- **Logs sem dados de empresas:** as bibliotecas HTTP só registram avisos; os logs do GitHub Actions de repositório público são visíveis para qualquer pessoa.
- **Vários workers ao mesmo tempo:** cada job em execução tem batimento (`heartbeat_at`). Outro worker só retoma um job sem batimento há mais de 20 minutos, e nunca roda dois jobs simultâneos.

- **RLS em todas as tabelas**, sem acesso anônimo. Os papéis são verificados no banco, não só na tela.
- **Dados cadastrais** só são gravados pelo worker. O cliente não escreve neles.
- **Auditoria automática** das alterações manuais. A carga em massa não gera ruído no log.
- **Histórico do CRM imutável** para o usuário: eventos de sistema não podem ser forjados.
- **Oposição ao contato:** bloqueia novos leads e move o existente para “Perdido”.
- **Segredos:** a `service_role` e a `DATABASE_URL` nunca vão para o frontend nem para o repositório (`.env` está no `.gitignore`).

## Integrações futuras (estrutura pronta)

As tabelas `message_templates` e `message_logs` e o registro `integration_status.whatsapp` já existem para receber a **WhatsApp Business Cloud API**: modelos aprovados pela Meta, envio controlado por Edge Function e webhooks de status. O campo `leads.digital_presence` recebe o enriquecimento de presença digital. Quando preenchido por uma verificação real, o critério “oportunidade digital” passa a pontuar. Não há nem haverá mecanismo de disparo em massa.

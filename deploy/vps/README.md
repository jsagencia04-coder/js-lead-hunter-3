# Migração do JS Lead Hunter para a VPS (Integrator, plano ICP Power)

Leva **tudo** para a VPS: banco PostgreSQL, login, API, função de convite, telas e worker.
Usa o **Supabase auto-hospedado** (código aberto, em Docker): nenhuma linha do sistema muda,
não há conta nem cobrança do Supabase, e as senhas dos usuários são preservadas.

> Regra desta migração: o Supabase em nuvem **não é alterado nem apagado**. Ele continua
> funcionando até a virada e fica intacto por 30 dias depois dela, como plano de volta.

## Visão geral

| Etapa | Onde | Impacto no sistema atual | Tempo |
| --- | --- | --- | --- |
| 0. Preparar DNS, SMTP e pastas | painel do domínio + VPS | nenhum | 30 min (+ propagação do DNS) |
| 1. Instalar o Supabase na VPS | VPS | nenhum | 30 min |
| 2. Ensaio: copiar, restaurar e conferir | VPS (só leitura na nuvem) | nenhum | 30–60 min |
| 3. Publicar as telas e testar | VPS | nenhum | 1–2 h de testes |
| 4. Virada | VPS + GitHub | sistema parado 1–2 h | fora do horário comercial |
| 5. Backup diário e conferências | VPS | nenhum | 20 min |

Recursos reservados na VPS (6 vCPU, 16 GB, 200 GB): Supabase até 2 vCPU / ~6 GB;
worker até 2 vCPU / ~4 GB. Os outros 2 sistemas usam hoje ~2,5 GB e 8% de CPU.

---

## 0. Preparar

1. **DNS** (no painel do domínio jsdesigner.pro): crie dois registros **A** apontando para `216.22.17.86`:
   - `leadhunter` (telas)  →  `leadhunter.jsdesigner.pro`
   - `api.leadhunter` (API) →  `api.leadhunter.jsdesigner.pro`
2. **SMTP** externo para convites e recuperação de senha (ex.: Brevo, Zoho, Resend, Amazon SES).
   Anote host, porta, usuário, senha e o e-mail remetente.
3. **Conferir portas já usadas** na VPS (para não conflitar com os outros sistemas):
   ```bash
   sudo ss -tlnp | grep -E ':(80|443|5432|8000|55432|56543)\b'
   ```
   O Supabase vai usar só `127.0.0.1:8000`, `127.0.0.1:55432` e `127.0.0.1:56543` (nada aberto para a internet).
4. **Pastas e código:**
   ```bash
   sudo mkdir -p /srv/js-lead-hunter && cd /srv/js-lead-hunter
   sudo git clone -b migracao-vps https://github.com/jsagencia04-coder/js-lead-hunter-3 app
   sudo cp app/deploy/vps/migracao.env.example migracao.env
   sudo chmod 600 migracao.env
   sudo nano migracao.env        # preencha CLOUD_DATABASE_URL, domínios e SMTP
   ```
   Este clone usa a cópia de trabalho `js-lead-hunter-3`. Se ela ficar privada, use uma *deploy key* do GitHub (somente leitura).

## 1. Instalar o Supabase auto-hospedado

```bash
cd /srv/js-lead-hunter
curl -fsSL https://raw.githubusercontent.com/supabase/supabase/master/docker/setup.sh -o setup.sh
sudo sh setup.sh --project-dir supabase --skip-deps -y     # tire --skip-deps se o Docker não estiver instalado
sudo bash app/deploy/vps/supabase/configurar-env.sh         # domínios, SMTP, convite-somente, limites, função invite-user
cd supabase && sudo docker compose config > /dev/null && sudo docker compose up -d
sudo docker compose ps                                      # todos "healthy" em ~2 minutos
```

O `setup.sh` oficial gera senhas e chaves novas no `.env`. O `configurar-env.sh` desliga o
cadastro aberto (acesso só por convite, como hoje), configura o SMTP e liga o arquivo
`docker-compose.jslh.yml`, que prende as portas em `127.0.0.1` e limita memória e CPU.

## 2. Ensaio da migração (o sistema atual continua no ar)

```bash
S=/srv/js-lead-hunter/app/deploy/vps/scripts
sudo bash $S/01-copiar-da-nuvem.sh       # só leitura no Supabase em nuvem
sudo bash $S/02-restaurar-na-vps.sh      # recusa rodar se o banco da VPS já tiver tabelas
sudo bash $S/03-conferir.sh              # compara linha a linha por tabela
```

- O `01` grava em `/srv/js-lead-hunter/migracao/<data-hora>/` o banco (`app.dump`), os usuários do
  login (`auth.sql`), o inventário e o `SHA256SUMS`. Esses arquivos têm dados pessoais: não saem da VPS.
- Como o worker atual continua importando durante o ensaio, o `03` pode mostrar pequenas diferenças.
  Na virada, com tudo parado, a diferença tem de ser **zero**.
- Para repetir o ensaio do zero: `sudo bash $S/00-zerar-ensaio.sh` (só funciona antes da virada; não
  apaga nada, renomeia a pasta antiga).

## 3. Publicar as telas e testar

1. Proxy reverso e SSL. Pelo **painel ICP** (recomendado, se ele gerencia os domínios):
   - `leadhunter.jsdesigner.pro` → site estático em `/srv/js-lead-hunter/www`, todas as rotas para `/index.html`;
   - `api.leadhunter.jsdesigner.pro` → proxy reverso para `http://127.0.0.1:8000`;
   - SSL ligado nos dois.

   Sem o painel, use `deploy/vps/nginx/js-lead-hunter.conf` num Nginx do host.
2. Compilar e publicar:
   ```bash
   sudo bash $S/04-publicar-frontend.sh
   ```
3. Roteiro de testes (marque cada item):
   - [ ] Login com um usuário existente e a **senha de sempre**
   - [ ] Recuperação de senha: o e-mail chega e o link abre `/redefinir-senha`
   - [ ] Convite de usuário pela Administração (função `invite-user`)
   - [ ] As 13 telas abrem com dados: Visão geral, Base, Mapa, Inteligência, Oportunidades, CRM,
         Agenda, Propostas, Clientes, Serviços, Relatórios, Importação, Administração
   - [ ] Criar e mover uma oportunidade de teste no CRM (e depois marcá-la como perdida)
   - [ ] Exportar uma lista para Excel
   - [ ] Painel do Supabase em `https://api.leadhunter.jsdesigner.pro` pede usuário e senha
         (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` do `.env`)

## 4. Virada (fora do horário comercial)

1. **Parar quem escreve no banco da nuvem:**
   - GitHub → *Actions* → desative os workflows **Worker de importação** e **Inteligência digital**;
   - no PC com Windows, feche o worker, se estiver rodando;
   - avise a equipe para não usar o sistema durante a virada.
2. **Backup de segurança da nuvem** (no PC com Windows): `worker\windows\6-fazer-backup.bat`.
3. **Banco novo na VPS e cópia final:**
   ```bash
   sudo bash $S/00-zerar-ensaio.sh
   sudo bash $S/01-copiar-da-nuvem.sh
   sudo bash $S/02-restaurar-na-vps.sh
   sudo bash $S/03-conferir.sh            # tem de terminar com "OK"
   ```
4. **Ligar o worker na VPS:**
   ```bash
   cd /srv/js-lead-hunter/app/deploy/vps/worker
   sudo cp .env.vps.example .env && sudo chmod 600 .env
   sudo nano .env            # senha = POSTGRES_PASSWORD de /srv/js-lead-hunter/supabase/.env
   sudo docker compose up -d --build
   sudo docker compose logs -f migrate worker   # o migrate deve dizer que não há migrations pendentes
   ```
5. **Marcar a VPS como produção** (impede o `00-zerar-ensaio.sh` de rodar de novo):
   ```bash
   sudo touch /srv/js-lead-hunter/PRODUCAO
   ```
6. Refazer os testes do passo 3 e liberar a equipe no endereço novo `https://leadhunter.jsdesigner.pro`.
7. No Netlify, troque o site antigo por um aviso ou redirecionamento para o endereço novo
   (não apague o site: ele é o plano de volta).

### Plano de volta (até 30 dias)

O Supabase em nuvem e o site no Netlify continuam intactos. Para voltar: pare o worker da VPS
(`docker compose down` na pasta do worker), reative os workflows no GitHub e use de novo o
endereço do Netlify. **Atenção:** o que foi registrado na VPS depois da virada não existe na
nuvem; se a volta acontecer, exporte antes o que foi feito no CRM nesse período.

## 5. Depois da virada

- **Backup diário** (cron do root):
  ```bash
  sudo crontab -e
  30 3 * * *  bash /srv/js-lead-hunter/app/deploy/vps/scripts/05-backup-diario.sh >> /var/log/js-lead-hunter-backup.log 2>&1
  ```
  Configure o `rclone` com um destino fora da VPS (Google Drive, R2 ou Backblaze) e preencha
  `RCLONE_REMOTE` e `BACKUP_GPG_PASSPHRASE` no `migracao.env`. Guarde a senha do GPG também fora da VPS.
- **Teste de restauração mensal:** suba um Supabase de teste, rode o `02` apontando para um backup
  diário e confira com o `03`.
- **Segredos:** troque a senha do banco da nuvem (ele deixa de ser usado), tire o `DATABASE_URL` dos
  Secrets do GitHub e torne o repositório privado.
- **Atualizações:** uma vez por mês, depois do backup:
  `cd /srv/js-lead-hunter/supabase && sudo sh update.sh && sudo sh run.sh pull && sudo sh run.sh recreate`.
- **Encerrar a nuvem:** depois de 30 dias sem problemas, faça um último backup e encerre o projeto
  no Supabase em nuvem.

## Arquivos deste pacote

| Arquivo | Para quê |
| --- | --- |
| `migracao.env.example` | Modelo das configurações e senhas da migração (fica em `/srv/js-lead-hunter/migracao.env`, permissão 600) |
| `supabase/docker-compose.jslh.yml` | Portas só em 127.0.0.1 e limites de memória/CPU sobre o compose oficial |
| `supabase/configurar-env.sh` | Ajusta o `.env` do Supabase: domínios, SMTP, convite-somente, portas, função `invite-user` |
| `scripts/00-zerar-ensaio.sh` | Recomeça o banco da VPS (só antes da virada) |
| `scripts/01-copiar-da-nuvem.sh` | Copia banco e usuários do Supabase em nuvem (só leitura) |
| `scripts/02-restaurar-na-vps.sh` | Restaura a cópia no banco da VPS e recria o gatilho de perfis |
| `scripts/03-conferir.sh` | Compara a quantidade de linhas de todas as tabelas |
| `scripts/04-publicar-frontend.sh` | Compila e publica as telas apontando para a API da VPS |
| `scripts/05-backup-diario.sh` | Backup diário no mesmo formato, com cópia externa criptografada |
| `worker/docker-compose.yml` + `.env.vps.example` | Worker na rede do Supabase, com limites |
| `nginx/js-lead-hunter.conf` | Referência de proxy reverso e SSL |

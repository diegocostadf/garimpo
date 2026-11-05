# Contas, publicação e assinatura

## 1. Contas Garimpo (login e controle de acesso)

O app usa o Supabase para login (e-mail e senha), plano, módulos liberados e registro de acessos.

1. Crie um projeto no Supabase (ou pelo Lovable, que usa o mesmo Supabase).
2. Em SQL Editor, rode `supabase/migrations/0001_access_control.sql`.
3. Em Authentication > Providers > Email, deixe ativo. Para controlar quem entra, desligue "Allow new users to sign up" e crie os usuários em Authentication > Users (ou deixe o cadastro aberto: novas contas nascem com status `pending`).
4. Marque seu usuário como administrador: `update profiles set is_admin = true, status = 'active', plan = 'dj', modules = array['downloads','converter','qobuz','dj'] where email = 'seu@email';`
5. No GitHub (Settings > Secrets and variables > Actions > Variables), crie `GARIMPO_SUPABASE_URL` (https://xxxx.supabase.co) e `GARIMPO_SUPABASE_ANON_KEY` (chave pública "anon").

Sem essas variáveis o app roda em **modo desenvolvimento**: sem login e com todos os módulos.

### Liberar e bloquear

| Ação | SQL |
|---|---|
| Aprovar | `update profiles set status='active' where email='x';` |
| Bloquear | `update profiles set status='blocked' where email='x';` |
| Plano DJ | `update profiles set plan='dj', modules=array['downloads','converter','qobuz','dj'] where email='x';` |
| Validade | `update profiles set expires_at='2027-01-01' where email='x';` |
| Quem usou | `select * from admin_users order by last_seen desc;` |

Módulos: `downloads`, `converter`, `dj`, `qobuz`. Cada login, abertura do app, saída e uso de módulo vai para `access_log` (versão, sistema e arquitetura).
O app mantém a sessão criptografada no chaveiro do sistema e funciona até 7 dias sem internet.

## 2. Versões e aviso de atualização

1. Atualize `version` no `package.json` e o `CHANGELOG.md`.
2. `git tag v0.3.1 && git push --tags`
3. O GitHub Actions (`.github/workflows/release.yml`) testa, gera os instaladores e publica o release com os arquivos de atualização.

O app confere novas versões 15 s após abrir e a cada 6 horas (ajustável em Ajustes) e mostra o aviso pedindo o download.
No Windows 64 bits a atualização instala sozinha; no Mac com assinatura ad hoc e no Windows 32 bits o botão abre a página de download.

**Importante:** releases de repositório privado não são visíveis para quem não tem acesso. Para o site e o aviso de atualização funcionarem para o público:
- torne o repositório público, **ou**
- crie um repositório público só de releases (ex.: `diegocostadf/garimpo-releases`), defina a variável `GARIMPO_RELEASES_REPO` com esse nome e o secret `RELEASES_TOKEN` (token com permissão de escrita nele).

## 3. Plataformas

| Sistema | Arquivos |
|---|---|
| Mac Apple Silicon (M1 ou mais novo) | `Garimpo-<versão>-arm64-mac.dmg` / `.zip` |
| Mac Intel | `Garimpo-<versão>-x64-mac.dmg` / `.zip` |
| Windows 10 e 11, 64 bits | `Garimpo-Setup-<versão>-x64.exe` (e portátil) |
| Windows 10 e 11, 32 bits | `Garimpo-Setup-<versão>-ia32.exe` (e portátil) |

O Electron 43 é a última série com Windows 32 bits (suporte até janeiro de 2027). Para manter o 32 bits depois disso, o app precisa ficar no Electron 43.

## 4. Assinatura

**Mac.** Sem conta Apple Developer, o app é assinado ad hoc (localmente). Funciona, mas na primeira abertura o macOS bloqueia: o usuário vai em Ajustes do Sistema > Privacidade e Segurança > "Abrir mesmo assim". Para remover o aviso:
1. Conta Apple Developer (US$ 99/ano) e certificado "Developer ID Application".
2. Secrets no GitHub: `MAC_CERT_P12` (o .p12 em base64), `MAC_CERT_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_ID`, `APPLE_APP_PASSWORD` (senha de app). O workflow assina e notariza; o app passa a se atualizar sozinho.
3. No seu Mac: `Gerar instaladores Mac.command` usa o Developer ID do Chaves se existir; senão, assina ad hoc.

**Windows.** Sem certificado, o SmartScreen mostra "editor desconhecido" (Mais informações > Executar assim mesmo). Com um certificado de assinatura de código, defina `WIN_CERT_P12` e `WIN_CERT_PASSWORD`.

# Relatório de QA · Garimpo 0.3.0

Data: 05/11/2026. Interface testada no app compilado com Playwright (Chromium), processo principal e servidor simulados. Resultado: **75 de 75 verificações passaram**.

Também passaram: typecheck (vue-tsc), 39 testes unitários (análise de áudio, formatos Serato/Rekordbox/M3U, biblioteca DJ com arquivos reais, importação de playlists, controle de acesso, regras de qualidade, plano de atualização), checagem de tradução e build.

## Correções feitas durante o QA

- Ajustes > Contas mostrava "Conectar" e o campo ARL mesmo com o Deezer conectado. Agora mostra o status (nome, plano, qualidade máxima, país) com Trocar conta e Sair; o ARL fica em "Avançado".
- A qualidade escolhida não respeitava o plano do Deezer: conta Free com FLAC escolhido pedia FLAC. Agora a qualidade efetiva é limitada pelo plano (Free: MP3 128, Premium: até 320, HiFi: FLAC) no download, no selo do topo (com *) e no menu, e as opções acima do plano ficam desabilitadas com aviso.
- Conta "Deezer Free" era tratada como Premium (o teste olhava só o nome "Free"). Agora a regra vem dos direitos de download da conta.
- Baixar sem Deezer conectado enfileirava um download que falharia. Agora abre o assistente de login com aviso.
- Spotify: com credenciais salvas, mostra "conectado" em vez de pedir de novo o assistente.
- Contraste: texto vermelho sobre fundo escuro e botões vermelhos com texto preto não passavam no WCAG AA. Ajustados para texto branco e vermelho mais claro no escuro / mais escuro no claro.
- Cores fora da paleta (verde, amarelo, azul, roxo) trocadas pela paleta Garimpo: preto, branco e vermelho.
- Abrir Ajustes por link (ex.: aba Contas) com a tela já aberta não trocava de aba.
- Diálogo de atualização no visual novo e com texto correto para Mac (instalação manual).

## Verificações


### Conta

- ✅ modo desenvolvimento sem login (card mostra Modo desenvolvimento)
- ✅ sem login mostra a tela de entrada
- ✅ botão Entrar só habilita com e-mail válido e senha ≥ 6 (vazio=True curta=True válida=True)
- ✅ erro de senha traduzido
- ✅ conta bloqueada explica e oferece Sair
- ✅ conta pendente mostra aguardando aprovação
- ✅ módulos fora do plano mostram cadeado no menu (2 cadeados)
- ✅ abrir módulo bloqueado leva à página explicativa (/locked?module=dj)
- ✅ logado mostra e-mail e plano, sem tela de entrada
- ✅ módulo liberado abre normalmente

### Deezer

- ✅ deslogado: menu mostra "Deezer · Conectar"
- ✅ deslogado: Ajustes mostra botão de conectar e campo ARL
- ✅ deslogado: ponto do selo vazado (w-1.5 h-1.5 rounded-full border border-foreground-muted)
- ✅ baixar sem Deezer abre o assistente de login

### Qualidade

- ✅ conta Free com 320 escolhido: selo mostra MP3 128* (MP3 128*)
- ✅ conta Free: menu mostra Deezer · MP3 128
- ✅ conta Free: 320 e FLAC desabilitados com aviso (aviso=1 320=True flac=True)
- ✅ conta Free: download enviado ao servidor em MP3_128 (MP3_128)

### Deezer

- ✅ logado: sem botão de conectar, com status e plano
- ✅ logado: campo ARL recolhido
- ✅ logado: ponto do selo preenchido (w-1.5 h-1.5 rounded-full bg-primary-500)

### Qualidade

- ✅ Premium com FLAC escolhido: selo MP3 320* (MP3 320*)
- ✅ HiFi com FLAC: selo FLAC sem aviso (FLAC)
- ✅ HiFi com 128 escolhido: respeita 128 (MP3 128)

### Spotify

- ✅ sem credenciais mostra assistente; com credenciais mostra conectado (sem=True com=True)

### Player

- ✅ abre flutuante e toca com VU ativo ({"playing": true, "meters": true, "next": true})
- ✅ clicar na barra avança a posição (22.8s)
- ✅ pausar
- ✅ próxima faixa da fila
- ✅ fechar some com o player

### Mesa

- ✅ canais com fader para baixando e fila (2 faders)
- ✅ estados Salvo, Falhou e contadores
- ✅ fader reflete o progresso (64%) (64)

### Converter

- ✅ detecta o serviço pelo link (SPOTIFY)
- ✅ mostra encontradas e faltando
- ✅ baixar sem Deezer abre o assistente
- ✅ filtro Faltando mostra só não encontradas

### Estúdio DJ

- ✅ biblioteca lista as faixas (6 linhas)
- ✅ filtro "combina com 8A" mostra 8A, 7A, 9A e 8B (3 faixas (Noite 8A, Lagoa 9A, Asfalto 8B))
- ✅ playlist mostra curva de energia e marca tom que não combina (2 marcações)
- ✅ aba Serato e Rekordbox com enviar, importar e converter

### Atualização

- ✅ nova versão abre aviso pedindo o download
- ✅ "Depois" fecha o aviso

### Tema

- ✅ tema dark aplicado (dark)

### Contraste (dark)

- ✅ contraste AA em / (0 elementos)

### Português

- ✅ texto em português em /

### Contraste (dark)

- ✅ contraste AA em /search (0 elementos)

### Português

- ✅ texto em português em /search

### Contraste (dark)

- ✅ contraste AA em /downloads (0 elementos)

### Português

- ✅ texto em português em /downloads

### Contraste (dark)

- ✅ contraste AA em /favorites (0 elementos)

### Português

- ✅ texto em português em /favorites

### Contraste (dark)

- ✅ contraste AA em /convert (0 elementos)

### Português

- ✅ texto em português em /convert

### Contraste (dark)

- ✅ contraste AA em /dj (0 elementos)

### Português

- ✅ texto em português em /dj

### Contraste (dark)

- ✅ contraste AA em /settings?tab=accounts (0 elementos)

### Português

- ✅ texto em português em /settings?tab=accounts

### Contraste (dark)

- ✅ contraste AA em /settings?tab=downloads (0 elementos)

### Português

- ✅ texto em português em /settings?tab=downloads

### Contraste (dark)

- ✅ contraste AA em /settings?tab=look (0 elementos)

### Português

- ✅ texto em português em /settings?tab=look

### Contraste (dark)

- ✅ contraste AA em /settings?tab=about (0 elementos)

### Português

- ✅ texto em português em /settings?tab=about

### Tema

- ✅ tema light aplicado (light)

### Contraste (light)

- ✅ contraste AA em / (0 elementos)
- ✅ contraste AA em /search (0 elementos)
- ✅ contraste AA em /downloads (0 elementos)
- ✅ contraste AA em /favorites (0 elementos)
- ✅ contraste AA em /convert (0 elementos)
- ✅ contraste AA em /dj (0 elementos)
- ✅ contraste AA em /settings?tab=accounts (0 elementos)
- ✅ contraste AA em /settings?tab=downloads (0 elementos)
- ✅ contraste AA em /settings?tab=look (0 elementos)
- ✅ contraste AA em /settings?tab=about (0 elementos)

## Não testável aqui

- Login real no Supabase (o projeto ainda não existe): testado contra um servidor simulado com as mesmas respostas da API.
- Download real do Deezer e Qobuz (exige conta): regras testadas no envio ao servidor.
- Instaladores Mac e Windows: gerados pelo GitHub Actions; o pacote Windows 32 bits foi montado e conferido aqui (PE32 Intel 80386).

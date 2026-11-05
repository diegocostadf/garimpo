# Changelog

## [0.3.0] - 2026-11-05

### Added
- Conta Garimpo: login com e-mail e senha, recuperação de senha, sessão criptografada, planos e módulos (Downloads, Converter, Estúdio DJ, Qobuz) com cadeado no menu, registro de acessos e modo desenvolvimento quando o login não está configurado.
- Aviso de nova versão ao abrir e a cada 6 horas, pedindo o download.
- Instaladores para Mac Intel e Apple Silicon e Windows 10/11 32 e 64 bits, com publicação automática por tag e assinatura ad hoc ou Developer ID.

### Fixed
- A qualidade de download respeita o plano do Deezer (Free: MP3 128) no download, no selo e no menu; opções acima do plano ficam desabilitadas.
- Conta Deezer conectada mostra o status e não pede para conectar de novo; o mesmo para o Spotify.
- Baixar sem Deezer conectado abre o assistente de login.
- Contraste AA em todas as telas, nos temas claro e escuro, e paleta preto, branco e vermelho em todo o app.

## [0.2.0] - 2026-11-05

### Added
- Player de prévia flutuante: arrastável para qualquer canto, barra de posição para avançar e voltar, volume, anterior e próxima, e VU meter estéreo que reage ao áudio.
- Converter: traz playlists do Spotify, Apple Music, YouTube Music, TIM Music e Deezer, ou uma lista colada (texto ou CSV), encontra cada música no catálogo e baixa tudo.
- Estúdio DJ: análise local de BPM, tom (Camelot) e energia de 1 a 10, gravados nos arquivos MP3 e FLAC.
- Playlists DJ com ordenação por harmonia e por BPM, curva de energia e aviso de tom que não combina.
- Envio para o Serato (crates) e para o Rekordbox (rekordbox xml), M3U para Engine DJ e djay Pro, e conversão Serato ↔ Rekordbox.

## [0.1.0] - 2026-11-04

### Added
- Nova identidade Garimpo: nome, símbolo da bateia com pepita, ícone do app e paleta dourada.
- Tema claro e escuro que segue o sistema, com contraste revisado em todas as telas.
- Tela inicial com busca e um campo para colar link direto.
- Barra lateral mais simples, com contador de downloads e status das contas.
- Seleção de várias faixas na busca com uma barra para baixar tudo de uma vez.

### Changed
- Tipografia Geist e textos mais diretos em português.
- A fila de downloads fica só na página Downloads, sem painel lateral fixo.
- Idioma padrão português do Brasil e pasta padrão Música/Garimpo.

# Garimpo

Encontre, organize e guarde sua música.

Garimpo é um app de desktop para Mac, Windows e Linux. Você busca faixas, álbuns, artistas e playlists, cola um link do Deezer, Qobuz ou Spotify, e o Garimpo baixa com as tags certas, a capa e, se quiser, a letra sincronizada. Ele também mantém playlists e artistas em dia sozinho e corrige as tags da biblioteca que você já tem.

## Recursos

- **Busca e descoberta**: lançamentos, paradas por país, gêneros e páginas de artista com a discografia completa.
- **Colar e baixar**: cole um ou vários links e veja tudo antes de baixar.
- **Qualidade à sua escolha**: MP3 128, MP3 320, FLAC e, com uma conta Qobuz paga, hi-res até 24-bit/192 kHz.
- **Fila clara**: pausar, retomar, reordenar e tentar de novo, com histórico.
- **Sincronização**: playlists e artistas acompanhados entram na fila sozinhos quando há novidade.
- **Biblioteca**: corrige tags dos arquivos que você já tem, sem baixar de novo.
- **Tema claro e escuro**, em 21 idiomas.

## Instalar no Mac

Dê dois cliques em **Instalar Garimpo.command**. Ele instala as dependências, compila o app para Apple Silicon e abre o Garimpo. Precisa do [Node.js](https://nodejs.org) ou do [Bun](https://bun.sh) instalado. Se o macOS bloquear o arquivo na primeira vez, clique com o botão direito nele e escolha **Abrir**.

## Rodando a partir do código

Requer [Bun](https://bun.sh) 1.1+ ou Node 22+.

```bash
bun install
bun run electron:dev        # modo desenvolvimento
bun run build:mac-local     # app para Mac (Apple Silicon), sem assinatura
bun run build:win           # instalador para Windows
bun run build:linux         # AppImage e .deb
```

O build local para Mac sai em `release/mac-arm64/Garimpo.app`. Como não é assinado, na primeira vez abra com clique direito e **Abrir**.

## Atualizações

O app procura novas versões nas releases de `github.com/diegocostadf/garimpo`.

## Licença

GPL-3.0. Veja `LICENSE` e `CREDITS.md`.

O Garimpo não tem relação com Deezer, Qobuz ou Spotify. Use com as suas próprias contas, para fins pessoais, respeitando os termos de cada serviço e os direitos dos artistas.

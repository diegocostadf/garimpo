# Garimpo: regras do projeto

## Visual

- Cores vêm de tokens. Use `bg-surface`, `border-line`, `hover:bg-hover`, `text-foreground`, `text-foreground-muted` e a escala `primary-*`. Não use `white/…`, `black/…` ou `zinc-*` para superfícies: quebram o modo claro.
- O tema padrão é `garimpo` (`src/assets/main.css`). Qualquer token novo precisa de valor no bloco escuro e no bloco `[data-mode="light"][data-theme="garimpo"]`.
- Tipografia é Geist Sans; Geist Mono só para números e dados técnicos (bitrate, ISRC, duração). Nada de rótulos em caixa alta com espaçamento largo.
- Alvos de toque com pelo menos 44px e texto com contraste AA nos dois modos.
- Uma ação principal por tela, em dourado. As demais são secundárias.

## Textos

- Nenhum texto de interface digitado direto no componente: tudo passa pelo vue-i18n. Chave nova entra nos 21 arquivos de `src/i18n/locales/` no mesmo commit. `bun scripts/i18n-check.ts` precisa passar.
- Frases curtas, voz ativa, sem jargão técnico na interface.

## Configurações

- Uma configuração do lado do servidor tem quatro ligações: tipo, padrão e validação em `electron/server.ts`, cada chamada de download, a lista `settingsToSync` em `downloadStore.ts` e a lista de chaves de perfil em `profileStore.ts`.

## Licença

- `LICENSE` e `CREDITS.md` são exigidos pela GPL-3.0. Não remova.

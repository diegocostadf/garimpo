#!/bin/bash
# Instala as dependências, compila o Garimpo para este Mac e abre o app.
# Dê dois cliques neste arquivo no Finder.

set -e
cd "$(dirname "$0")"

echo ""
echo "  Garimpo · instalação"
echo "  --------------------"
echo ""

# Apple Silicon (arm64) ou Intel (x64)
if [ "$(uname -m)" = "arm64" ]; then ARCH="arm64"; DIR="mac-arm64"; else ARCH="x64"; DIR="mac"; fi
echo "Mac detectado: $ARCH"

if command -v bun >/dev/null 2>&1; then
  RUN="bun"
  echo "Usando Bun $(bun --version)"
elif command -v npm >/dev/null 2>&1; then
  RUN="npm"
  echo "Usando Node $(node --version)"
else
  echo "Não encontrei Node.js nem Bun neste Mac."
  echo "Instale o Node.js LTS em https://nodejs.org e rode este arquivo de novo."
  read -n 1 -s -r -p "Pressione qualquer tecla para fechar."
  exit 1
fi

echo ""
echo "1/3  Instalando dependências (pode levar alguns minutos)..."
if [ "$RUN" = "bun" ]; then bun install; else npm install --no-audit --no-fund; fi

echo ""
echo "2/3  Compilando o app..."
# Pastas sincronizadas com o iCloud (como Documentos) colam metadados ocultos
# nos arquivos, e a assinatura do macOS recusa o app. Por isso a compilação
# acontece numa pasta fora do iCloud.
OUT="$HOME/Library/Caches/garimpo-build"
rm -rf dist dist-electron release "$OUT"
npx vite build
xattr -cr dist dist-electron public 2>/dev/null || true
# Assinatura local: ad hoc (sem conta Apple), suficiente para rodar neste Mac.
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --$ARCH \
  -c.mac.notarize=false -c.mac.identity=- -c.directories.output="$OUT" --publish never

BUILT="$OUT/$DIR/Garimpo.app"
if [ ! -d "$BUILT" ]; then
  echo "A compilação terminou sem gerar o app. Veja as mensagens acima."
  read -n 1 -s -r -p "Pressione qualquer tecla para fechar."
  exit 1
fi

echo ""
echo "3/3  Instalando em ~/Applications..."
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/Garimpo.app"
ditto --norsrc "$BUILT" "$HOME/Applications/Garimpo.app"
rm -rf "$OUT"

echo ""
echo "Pronto! O Garimpo está na sua pasta Aplicativos pessoal (~/Applications)."
echo ""
open "$HOME/Applications/Garimpo.app"

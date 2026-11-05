#!/bin/bash
# Instala as dependências, compila o Garimpo para este Mac e abre o app.
# Dê dois cliques neste arquivo no Finder.

set -e
cd "$(dirname "$0")"

echo ""
echo "  Garimpo · instalação"
echo "  --------------------"
echo ""

if [ "$(uname -m)" != "arm64" ]; then
  echo "Este script compila para Macs com Apple Silicon (M1 ou mais novo)."
  echo "Em Mac Intel, rode: npm install && npx vite build && npx electron-builder --mac dir --x64"
  exit 1
fi

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
rm -rf dist dist-electron release
npx vite build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --arm64 -c.mac.notarize=false

APP="release/mac-arm64/Garimpo.app"
if [ ! -d "$APP" ]; then
  echo "A compilação terminou sem gerar $APP. Veja as mensagens acima."
  read -n 1 -s -r -p "Pressione qualquer tecla para fechar."
  exit 1
fi

echo ""
echo "3/3  Pronto! O app está em: $(pwd)/$APP"
echo "     Para deixá-lo junto dos outros apps, arraste Garimpo.app para a pasta Aplicativos."
echo ""
open "$APP"

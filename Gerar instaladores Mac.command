#!/bin/bash
# Gera os instaladores do Garimpo para Mac (Intel e Apple Silicon), assinados
# neste computador, prontos para publicar no site / GitHub.
#
# Assinatura:
#   - Se houver um certificado "Developer ID Application" no Chaves (Keychain),
#     ele é usado. Com APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD e APPLE_TEAM_ID no
#     ambiente, o app também é notarizado (sem aviso do Gatekeeper).
#   - Sem certificado, a assinatura é ad hoc: o app funciona, mas na primeira
#     abertura o macOS pede confirmação (Ajustes > Privacidade e Segurança > Abrir mesmo assim).

set -e
cd "$(dirname "$0")"
echo ""
echo "  Garimpo · instaladores para Mac"
echo "  -------------------------------"

if command -v bun >/dev/null 2>&1; then bun install; else npm install --no-audit --no-fund; fi

OUT="$HOME/Library/Caches/garimpo-release"
rm -rf dist dist-electron "$OUT"
npx vite build
xattr -cr dist dist-electron public 2>/dev/null || true

IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null | grep "Developer ID Application" | head -1 | sed -E 's/.*"(.*)"/\1/')
if [ -n "$IDENTITY" ]; then
  echo "Assinando com: $IDENTITY"
  NOTARIZE=false; [ -n "$APPLE_ID" ] && [ -n "$APPLE_TEAM_ID" ] && NOTARIZE=true
  GARIMPO_APPLE_TEAM_ID="$APPLE_TEAM_ID" npx electron-builder --mac --x64 --arm64 --publish never \
    -c.directories.output="$OUT" -c.mac.notarize=$NOTARIZE
else
  echo "Nenhum Developer ID encontrado: assinatura ad hoc local."
  CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --x64 --arm64 --publish never \
    -c.directories.output="$OUT" -c.mac.identity=- -c.mac.notarize=false
fi

for app in "$OUT"/mac*/Garimpo.app; do
  echo ""
  echo "Verificando $app"
  codesign --verify --deep --strict "$app" && echo "  assinatura ok"
  codesign -dv "$app" 2>&1 | grep -E "Signature|Authority" | head -2
  lipo -archs "$app/Contents/MacOS/Garimpo"
done

DEST="$(pwd)/release"
mkdir -p "$DEST"
cp "$OUT"/*.dmg "$OUT"/*.zip "$DEST"/ 2>/dev/null || true
echo ""
echo "Pronto! Instaladores em: $DEST"
open "$DEST"

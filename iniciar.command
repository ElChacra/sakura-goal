#!/bin/bash
# Sakura Arcade Goal — doble clic en macOS (la primera vez: clic derecho → Abrir).
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "[!] No encuentro Node.js. Instala la versión LTS desde https://nodejs.org y vuelve a abrir este archivo."
  read -r -p "Pulsa Enter para cerrar…"; exit 1
fi
MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 20 ]; then
  echo "[!] Tienes Node.js $MAJOR, se necesita la versión 20 o superior (https://nodejs.org)."
  read -r -p "Pulsa Enter para cerrar…"; exit 1
fi
if [ ! -d node_modules/ws ]; then
  echo "Instalando dependencias por primera vez…"
  npm install --omit=dev --no-audit --no-fund || { echo "[!] Falló npm install. Revisa tu conexión."; read -r -p "Enter…"; exit 1; }
fi
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Se creó el archivo .env: ábrelo con TextEdit para poner tus tokens."
fi
node relay/server.js
echo "El relay se cerró."
read -r -p "Pulsa Enter para cerrar…"

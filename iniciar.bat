@echo off
chcp 65001 >nul
title Sakura Arcade Goal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] No encuentro Node.js. Instala la version LTS desde https://nodejs.org
  echo      y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo.
  echo  [!] Tienes Node.js %NODE_MAJOR%, se necesita la version 20 o superior.
  echo      Descarga la LTS desde https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\ws" (
  echo  Instalando dependencias por primera vez, espera un momento...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo  [!] Fallo npm install. Revisa tu conexion a internet.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo  Se creo el archivo .env: abrelo con el Bloc de notas para poner tus tokens.
)

node relay\server.js
echo.
echo  El relay se cerro.
pause

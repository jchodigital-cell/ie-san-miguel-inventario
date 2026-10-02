@echo off
title JCHO - Inventario Ferreteria IE San Miguel
cd /d "C:\Users\jchod\OneDrive\Desktop\Herramientas-material-ferreteria-IESanMiguel"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta instalado. Instalalo desde https://nodejs.org
  pause
  exit /b 1
)
if not exist data (
  node backend\src\seed.js
)
start "" http://localhost:3000
node backend\src\server.js

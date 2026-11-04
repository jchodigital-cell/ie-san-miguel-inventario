@echo off
title IE San Miguel - Inventario General Tecnológico y Mobiliario
cd /d "%~dp0"

echo ============================================
echo   IE SAN MIGUEL - SISTEMA DE INVENTARIO
echo   Tecnológico y Mobiliario
echo ============================================
echo.

:: Verificar Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js no esta instalado.
  echo Instalelo desde https://nodejs.org
  pause
  exit /b 1
)

:: Verificar dependencias
if not exist "node_modules" (
  echo Instalando dependencias de Node.js...
  npm install
  if errorlevel 1 (
    echo ERROR al instalar dependencias.
    pause
    exit /b 1
  )
)

:: Inicializar base de datos MySQL (XAMPP)
echo.
echo Verificando base de datos MySQL...
echo Asegurese de que XAMPP y MySQL esten iniciados.
echo.
node backend\src\init-db.js

:: Sembrar datos iniciales
echo.
node backend\src\seed.js

:: Abrir navegador
start "" http://localhost:3000

echo.
echo Sistema iniciado correctamente.
echo Acceso: http://localhost:3000
echo Usuario admin: admin / admin123
echo.
echo Si el servidor se detiene, cierre y vuelva a ejecutar este archivo.
:loop
node backend\src\server.js
echo.
echo El servidor se detuvo. Reiniciando en 3 segundos... (Ctrl+C para salir)
timeout /t 3 /nobreak >nul
goto loop

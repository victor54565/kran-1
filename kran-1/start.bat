@echo off
cd /d "%~dp0"
title Клуб Крановщиков - Сервер
echo Запускаю сервер...
start "Клуб Крановщиков - Сервер" cmd /k node server.js
timeout /t 2 /nobreak >nul
start "" http://localhost:3000

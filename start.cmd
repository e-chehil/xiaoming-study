@echo off
setlocal
chcp 65001 >nul
title Xiaoming Typing
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 or later is required.
  pause
  exit /b 1
)
node scripts/serve.mjs --open
if errorlevel 1 pause

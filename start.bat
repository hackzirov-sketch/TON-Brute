@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Avval setup.bat faylini ishga tushiring.
  pause
  exit /b 1
)
if not exist "dist\bridge.js" (
  echo TON moduli topilmadi. setup.bat faylini qayta ishga tushiring.
  pause
  exit /b 1
)

call ".venv\Scripts\python.exe" app.py
if errorlevel 1 pause

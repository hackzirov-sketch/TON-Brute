@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Avval setup.bat faylini ishga tushiring.
  pause
  exit /b 1
)
if not exist "dist\auto-bridge.js" (
  echo TON moduli topilmadi. setup.bat faylini qayta ishga tushiring.
  pause
  exit /b 1
)

echo.
echo  ========================================
echo   TONfinder Scanner Service
echo  ========================================
echo.
echo  Servisni to'xtatish uchun Ctrl+C bosing
echo.

call ".venv\Scripts\python.exe" run.py
if errorlevel 1 pause

@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul || (echo Node.js 22+ kerak. & pause & exit /b 1)
where py >nul 2>nul || (echo Python 3 kerak. & pause & exit /b 1)

echo [1/3] Solana kutubxonalari o'rnatilmoqda...
call npm install || (pause & exit /b 1)
call npm run build || (pause & exit /b 1)

echo [2/3] Python muhiti tayyorlanmoqda...
if not exist ".venv\Scripts\python.exe" py -m venv .venv
call ".venv\Scripts\python.exe" -m pip install -r requirements.txt || (pause & exit /b 1)

echo [3/3] Tayyor.
echo Endi start.bat faylini oching.
pause

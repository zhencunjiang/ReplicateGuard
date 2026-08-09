@echo off
setlocal
cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm was not found. Install Node.js and run: corepack enable
  exit /b 1
)

echo [1/3] Installing locked dependencies...
call pnpm install --frozen-lockfile
if errorlevel 1 exit /b 1

echo [2/3] Running type checks, tests and production build...
call pnpm run check
if errorlevel 1 exit /b 1

echo [3/3] Building the Windows x64 NSIS installer...
call pnpm run dist:win
if errorlevel 1 exit /b 1

echo.
echo Build complete:
echo release\ReplicateGuard-0.1.0-Windows-x64-Setup.exe
endlocal

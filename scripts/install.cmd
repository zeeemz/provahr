@echo off
rem ============================================================
rem  ProvaHR installer (Windows cmd, no PowerShell).
rem
rem  Usage:
rem    scripts\install.cmd            install + prepare database schema
rem    scripts\install.cmd --seed     ... and seed demo data afterwards
rem ============================================================
setlocal EnableExtensions

rem -- Resolve the repo root from this script's location ---------------------
cd /d "%~dp0.."
if errorlevel 1 (
  echo ERROR: could not enter the repository root. 1>&2
  exit /b 1
)

rem -- Parse arguments --------------------------------------------------------
set "SEED=0"
:parse
if "%~1"=="" goto parsed
if /i "%~1"=="--seed" (
  set "SEED=1"
) else (
  echo ERROR: unknown option %~1 1>&2
  echo Usage: scripts\install.cmd [--seed] 1>&2
  exit /b 1
)
shift
goto parse
:parsed

rem -- Prerequisites ----------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found on PATH. 1>&2
  echo        Install Node 20 or newer from https://nodejs.org and re-run. 1>&2
  exit /b 1
)
for /f "usebackq delims=" %%v in (`node -v`) do set "NODE_VERSION=%%v"
rem Strip the leading "v", then take everything before the first "." as major.
for /f "tokens=1 delims=." %%a in ("%NODE_VERSION:~1%") do set "NODE_MAJOR=%%a"
if %NODE_MAJOR% LSS 20 (
  echo ERROR: Node %NODE_VERSION% found, but ProvaHR requires Node 20 or newer. 1>&2
  echo        Upgrade from https://nodejs.org and re-run. 1>&2
  exit /b 1
)

echo === Detected versions ===
echo node  %NODE_VERSION%
call npm -v
where docker >nul 2>nul
if errorlevel 1 (
  echo docker not found - start PostgreSQL manually ^(or install Docker and run: docker compose up -d db^)
) else (
  docker --version
)
echo.

rem -- Dependencies (npm workspaces install from the repo root) ---------------
echo === Installing dependencies (npm workspaces) ===
call npm install
if errorlevel 1 (
  echo ERROR: npm install failed. 1>&2
  exit /b 1
)
echo.

rem -- API environment file + database schema ---------------------------------
cd apps\api
if not exist ".env" (
  copy ".env.example" ".env" >nul
  if errorlevel 1 (
    echo ERROR: could not copy .env.example to .env. 1>&2
    exit /b 1
  )
  echo created .env - defaults target localhost Postgres
)

echo === Generating the Prisma client ===
call npx prisma generate
if errorlevel 1 (
  echo ERROR: prisma generate failed. 1>&2
  exit /b 1
)

echo === Applying the database schema ===
rem Does at least one committed migration exist? Without one, `prisma migrate
rem deploy` hard-fails ("No migration found in prisma/migrations"), so push the
rem schema straight from schema.prisma instead. This branch turns itself off
rem once migrations land.
set "MIGRATIONS_FOUND=0"
for /f "delims=" %%f in ('dir /b /s "prisma\migrations\migration.sql" 2^>nul') do set "MIGRATIONS_FOUND=1"
if "%MIGRATIONS_FOUND%"=="1" (
  echo Applying committed migrations (prisma migrate deploy)...
  call npx prisma migrate deploy
) else (
  echo NOTE: no committed migrations under apps\api\prisma\migrations yet.
  echo       Creating the schema directly from schema.prisma (prisma db push).
  call npx prisma db push
)
if errorlevel 1 (
  echo ERROR: database schema step failed. Is PostgreSQL running and reachable per apps\api\.env? 1>&2
  exit /b 1
)

if "%SEED%"=="1" (
  echo === Seeding demo data (--seed) ===
  call npm run seed
  if errorlevel 1 (
    echo ERROR: npm run seed failed. 1>&2
    exit /b 1
  )
)

cd /d "%~dp0.."

rem -- Done --------------------------------------------------------------------
echo.
echo ============================================================
echo  ProvaHR install complete
echo ============================================================
echo Next steps:
echo   1. Start the API:
echo        npm run dev:api        (from the repo root)
echo   2. Open the setup wizard in a browser:
echo        http://localhost:4000/setup
echo      It creates your company + first admin, then locks itself.
echo   3. Pointers: README.md, docs/PLAN.md, docs/RBAC.md
echo ============================================================
endlocal
exit /b 0

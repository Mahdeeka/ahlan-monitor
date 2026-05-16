@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo  AFC Monitor — Deploy to Vercel
echo ============================================================
echo.

REM ---- Check Node + npm ----
node --version >nul 2>&1 || (echo [ERROR] Install Node from https://nodejs.org && pause && exit /b 1)
where vercel >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing Vercel CLI globally...
    call npm install -g vercel
    if errorlevel 1 (echo [ERROR] Vercel CLI install failed && pause && exit /b 1)
)

echo Step 1/5: Vercel login (browser will open)
echo --------------------------------------------------
call vercel login
echo.

echo Step 2/5: Linking project (will create or link existing)
echo --------------------------------------------------
call vercel link
echo.

echo Step 3/5: Setting up Postgres database
echo --------------------------------------------------
echo NOTE: Vercel Postgres is now powered by Neon.
echo  - On Pro plan, you get one free DB.
echo  - This command opens your browser to create one.
call vercel storage create
echo.
echo After creating the database in the browser, link it to this project
echo (Vercel dashboard - Storage - Connect to project).
pause

echo Step 4/5: Pulling environment variables (Postgres connection)
echo --------------------------------------------------
call vercel env pull .env.development.local
echo.

echo Step 5/5: Deploying to production
echo --------------------------------------------------
call vercel --prod
echo.

echo ============================================================
echo  Deploy complete!
echo  Visit the URL above, then go to:
echo    YOUR-URL/api/init   (one time, initializes DB schema)
echo  Cron starts polling every minute automatically.
echo ============================================================
pause

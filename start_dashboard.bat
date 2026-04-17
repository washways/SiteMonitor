@echo off
set PORT=3000
echo Starting local Python HTTP server on port %PORT%...
where python >nul 2>nul && (
    start /min cmd /c "python -m http.server %PORT% --directory public"
) || (
    start /min cmd /c "py -m http.server %PORT% --directory public"
)

echo Waiting for server to start...
timeout /t 2 >nul

echo Opening dashboard in your default browser...
start "" "http://localhost:%PORT%/index.html?proxy=1"

echo Done. Local access is enabled for localhost.
pause

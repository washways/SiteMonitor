@echo off
echo Starting local Python HTTP server on port 3000...
start /min cmd /c "python -m http.server 3000 --directory public"

echo Waiting for server to start...
timeout /t 2 >nul

echo Opening Dashboard in Chrome (CORS Disabled Mode)...
echo WARNING: Do not use this Chrome window for regular browsing.
start "" "chrome.exe" --user-data-dir="c:\temp\chrome_dev_session" --disable-web-security "http://localhost:3000/index.html"

echo Done.
pause

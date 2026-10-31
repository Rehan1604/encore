@echo off
cd /d %~dp0
if not exist .env copy .env.example .env >nul
if not exist .venv (
  echo Creating Python environment...
  python -m venv .venv
)
call .venv\Scripts\activate
echo Installing packages (first run takes a minute)...
pip install -q -r backend\requirements.txt
echo.
echo Encore is starting at http://localhost:8000
start "" http://localhost:8000
python -m uvicorn app.main:app --app-dir backend --port 8000

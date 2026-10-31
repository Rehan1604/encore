#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate
pip install -q -r backend/requirements.txt
echo "Encore is starting at http://localhost:8000"
python -m uvicorn app.main:app --app-dir backend --port 8000

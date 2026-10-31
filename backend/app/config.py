"""All settings come from the .env file in the project root."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]          # encore/
BACKEND = ROOT / "backend"
load_dotenv(ROOT / ".env")

UPLOADS = Path(os.getenv("UPLOAD_DIR", str(BACKEND / "uploads")))
UPLOADS.mkdir(parents=True, exist_ok=True)
STATIC = BACKEND / "static"
PROMPTS = BACKEND / "app" / "prompts"

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()

# Any OpenAI-compatible chat API works. Default: Groq (one free key for everything).
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
LLM_API_KEY = os.getenv("LLM_API_KEY", "").strip() or GROQ_API_KEY
LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")
LLM_FALLBACK_MODEL = os.getenv("LLM_FALLBACK_MODEL", "openai/gpt-oss-20b")

WHISPER_BASE_URL = os.getenv("WHISPER_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
WHISPER_API_KEY = os.getenv("WHISPER_API_KEY", "").strip() or GROQ_API_KEY
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "whisper-large-v3-turbo")

_db = os.getenv("DATABASE_URL", "").strip()
if _db.startswith("postgres://"):
    _db = "postgresql+psycopg://" + _db[len("postgres://"):]
elif _db.startswith("postgresql://"):
    _db = "postgresql+psycopg://" + _db[len("postgresql://"):]
DATABASE_URL = _db or f"sqlite:///{BACKEND / 'encore.db'}"

_force_mock = os.getenv("ENCORE_MOCK", "").lower() in ("1", "true", "yes")
LLM_MOCK = _force_mock or not LLM_API_KEY
WHISPER_MOCK = _force_mock or not WHISPER_API_KEY

CREATOR_NAME = os.getenv("CREATOR_NAME", "Rehan")

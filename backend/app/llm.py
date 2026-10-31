"""One function talks to the LLM: chat_json. Every call is written to the trace table."""
import json
import re
import time
from typing import Callable

import httpx

from . import config
from .db import SessionLocal, Trace


class LLMError(RuntimeError):
    pass


def load_prompt(name: str) -> str:
    return (config.PROMPTS / name).read_text(encoding="utf-8")


def parse_json(text: str) -> dict:
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start:end + 1])
        raise


def _record(step: str, summary: str, output: dict | str, ms: int, mock: bool, ok: bool) -> None:
    out = output if isinstance(output, str) else json.dumps(output, ensure_ascii=False, indent=2)
    with SessionLocal() as s:
        s.add(Trace(step=step, model="demo-mode" if mock else config.LLM_MODEL,
                    input_summary=summary[:2000], output_json=out[:20000],
                    ms=ms, mock=mock, ok=ok))
        s.commit()


def other_model(model: str) -> str:
    return config.LLM_FALLBACK_MODEL if model == config.LLM_MODEL else config.LLM_MODEL


def chat_json(step: str, system: str, user: str, *, summary: str,
              mock: Callable[[], dict], temperature: float = 0.4,
              effort: str = "medium", model: str | None = None) -> dict:
    """Ask for JSON, retry once, trace everything. Falls back to `mock` in demo mode."""
    t0 = time.time()
    if config.LLM_MOCK:
        data = mock()
        time.sleep(0.6)  # keeps the progress UI honest-looking in demo mode
        _record(step, summary, data, int((time.time() - t0) * 1000), True, True)
        return data

    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    payload: dict = {"model": model or config.LLM_MODEL, "messages": messages,
                     "temperature": temperature, "response_format": {"type": "json_object"}}
    if "gpt-oss" in payload["model"]:
        payload["reasoning_effort"] = effort

    last_err = ""
    fallback_used = False
    for attempt in range(7):
        try:
            r = httpx.post(f"{config.LLM_BASE_URL}/chat/completions",
                           headers={"Authorization": f"Bearer {config.LLM_API_KEY}"},
                           json=payload, timeout=180)
        except httpx.HTTPError as e:
            last_err = f"network error: {e}"
            time.sleep(2)
            continue
        if r.status_code == 413:
            last_err = f"{r.status_code}: {r.text[:300]}"
            break
        if r.status_code == 429:
            # Free tier: each model has its own tokens-per-minute bucket. Try the other model first,
            # then wait as long as Groq asks.
            last_err = f"{r.status_code}: {r.text[:300]}"
            if config.LLM_FALLBACK_MODEL and not fallback_used:
                fallback_used = True
                payload["model"] = other_model(payload["model"])
                if "gpt-oss" not in payload["model"]:
                    payload.pop("reasoning_effort", None)
                continue
            try:
                wait = float(r.headers.get("retry-after") or 0)
            except ValueError:
                wait = 0
            m = re.search(r"try again in ([\d.]+)s", r.text)
            wait = max(wait, float(m.group(1)) if m else 0, 3)
            time.sleep(min(wait + 1, 65))
            continue
        if r.status_code >= 500:
            last_err = f"{r.status_code}: {r.text[:300]}"
            time.sleep(3 * (attempt + 1))
            continue
        if r.status_code >= 400:
            last_err = f"{r.status_code}: {r.text[:500]}"
            if "json_validate_failed" in r.text:
                payload["messages"] = messages + [{"role": "user", "content":
                                                   "Your last answer was not valid JSON. Return ONLY the JSON object."}]
                continue
            if "reasoning" in r.text and "reasoning_effort" in payload:
                payload.pop("reasoning_effort")
                continue
            if "response_format" in r.text and "response_format" in payload:
                payload.pop("response_format")
                continue
            break
        content = r.json()["choices"][0]["message"].get("content") or ""
        try:
            data = parse_json(content)
            if not isinstance(data, dict):
                raise ValueError("not an object")
            _record(step, summary, data, int((time.time() - t0) * 1000), False, True)
            return data
        except (json.JSONDecodeError, ValueError):
            last_err = f"invalid JSON: {content[:300]}"
            payload["messages"] = messages + [{"role": "user", "content":
                                               "Return ONLY a valid JSON object, nothing else."}]
    _record(step, summary, last_err, int((time.time() - t0) * 1000), False, False)
    raise LLMError(f"The AI call for '{step}' failed. {last_err}")

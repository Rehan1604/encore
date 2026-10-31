"""Audio extraction (bundled ffmpeg) and Whisper transcription (Groq by default)."""
import re
import shutil
import subprocess
from pathlib import Path

import httpx

from . import config


def ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        exe = shutil.which("ffmpeg")
        if not exe:
            raise RuntimeError("ffmpeg not found. Run: pip install imageio-ffmpeg")
        return exe


def probe(src: Path) -> tuple[float, bool]:
    """Return (duration in seconds, has a video stream)."""
    proc = subprocess.run([ffmpeg_exe(), "-hide_banner", "-i", str(src)],
                          capture_output=True, text=True, errors="ignore")
    err = proc.stderr
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", err)
    dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0
    has_video = bool(re.search(r"Stream #.*Video:", err)) and "attached pic" not in err
    return dur, has_video


def extract_audio(src: Path) -> Path:
    """Small mono mp3 so even a 60-minute file stays well under the upload limit."""
    out = src.with_name(src.stem + ".audio.mp3")
    cmd = [ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
           "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", str(out)]
    proc = subprocess.run(cmd, capture_output=True, text=True, errors="ignore")
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg could not read this file: {proc.stderr[-400:]}")
    return out


def transcribe(audio: Path, duration: float) -> tuple[list[dict], str]:
    """Return ([{start, end, text}], language)."""
    if config.WHISPER_MOCK:
        return mock_segments(duration), "en"
    with open(audio, "rb") as f:
        r = httpx.post(
            f"{config.WHISPER_BASE_URL}/audio/transcriptions",
            headers={"Authorization": f"Bearer {config.WHISPER_API_KEY}"},
            data={"model": config.WHISPER_MODEL, "response_format": "verbose_json",
                  "temperature": "0"},
            files={"file": (audio.name, f, "audio/mpeg")},
            timeout=600,
        )
    if r.status_code >= 400:
        raise RuntimeError(f"Whisper failed ({r.status_code}): {r.text[:400]}")
    body = r.json()
    segs = [{"start": float(s["start"]), "end": float(s["end"]), "text": s["text"].strip()}
            for s in body.get("segments", []) if s.get("text", "").strip()]
    if not segs and body.get("text"):
        segs = [{"start": 0.0, "end": duration or 1.0, "text": body["text"].strip()}]
    return segs, body.get("language", "")


# Demo-mode transcript: a believable build log, spread over the real duration.
MOCK_LINES = [
    "Okay, we're recording. It's hour five of a nine-hour hackathon and we have a working product.",
    "So the problem is simple. Creators record an hour of video and post maybe one clip from it.",
    "We asked eight creator friends on WhatsApp and most said repurposing one video takes them three to four hours.",
    "And the clip tools they tried all pick the same kind of loud, generic moments.",
    "Here's the thing nobody says out loud: viral for everyone is not the same as working for you.",
    "So Encore does two things no clip tool does for you personally.",
    "One, it learns your voice from your edits. Every time you fix a draft, it writes down a rule.",
    "Like, I deleted the word excited from three drafts and now it just never uses it.",
    "Two, it learns from your real numbers. You upload your LinkedIn analytics and it changes what it picks next.",
    "Our first post today got about four times more impressions when it opened with a number.",
    "And the next ranking moved every number-first clip up. That's the whole loop, live.",
    "The funny part is we didn't type a single prompt today. Everything was dictated with Wispr Flow.",
    "Honestly, speaking prompts makes them longer and better. You explain the why, not just the what.",
    "Main bug of the day was timestamps. Whisper gives segments and we had to snap clips to clean sentence breaks.",
    "We almost built video rendering and then cut it. Clips play right in the browser with captions instead.",
    "That one cut saved us like two hours, and the demo actually looks better.",
    "Rule number one for hackathons: cut features before features cut you.",
    "If you're a creator, the dream is simple. Record once, post all week, and sound like yourself every time.",
    "Bas, that's the idea. Ek video, poore hafte ka content.",
    "Next we want the calendar to suggest times from what actually performed for you, not some generic chart.",
    "And yes, every post we put on LinkedIn today was written by Encore. We changed one line in each.",
    "Guess which line. That's the game we're playing in the comments.",
    "If this works, the posts get better every single time someone reacts to them.",
    "Alright, that's the build log. Back to shipping.",
]


def mock_segments(duration: float) -> list[dict]:
    n = len(MOCK_LINES)
    total = duration if duration >= 60 else n * 7.0
    step = total / n
    out = []
    for i, line in enumerate(MOCK_LINES):
        start = round(i * step, 2)
        end = round(min(total, start + step - 0.2), 2)
        out.append({"start": start, "end": end, "text": line})
    return out

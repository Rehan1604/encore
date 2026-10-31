"""Encore API + the built frontend, served from one process on http://localhost:8000."""
import os
import re
import subprocess
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import config, linkedin, services
from .db import (Clip, ClipRun, Insight, Post, Segment, SessionLocal, Trace, Video,
                 VoiceLog, VoiceRule, init_db)
from .llm import LLMError
from .transcribe import extract_audio, ffmpeg_exe, probe, transcribe

app = FastAPI(title="Encore")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
init_db()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.exception_handler(LLMError)
async def llm_error(_: Request, exc: LLMError):
    return JSONResponse({"detail": str(exc)}, status_code=502)


@app.exception_handler(ValueError)
async def value_error(_: Request, exc: ValueError):
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.exception_handler(RuntimeError)
async def runtime_error(_: Request, exc: RuntimeError):
    return JSONResponse({"detail": str(exc)}, status_code=502)


# ---------- serializers ----------

def iso(d: datetime | None) -> str | None:
    return d.isoformat() if d else None


def s_video(v: Video, segments: bool = False) -> dict:
    out = {"id": v.id, "title": v.title, "url": f"/media/{v.filename}", "has_video": v.has_video,
           "duration_s": v.duration_s, "language": v.language, "mock": v.mock,
           "created_at": iso(v.created_at), "segment_count": len(v.segments)}
    if segments:
        out["segments"] = [{"idx": s.idx, "start": s.start_s, "end": s.end_s, "text": s.text} for s in v.segments]
    return out


def s_clip(c: Clip) -> dict:
    return {"id": c.id, "run_id": c.run_id, "status": c.status, "rank": c.rank,
            "start_seg": c.start_seg, "end_seg": c.end_seg, "start": c.start_s, "end": c.end_s,
            "title": c.title, "score": c.score, "scores": c.scores, "reasons": c.reasons,
            "editor_note": c.editor_note, "hook_line": c.hook_line, "why": c.why}


def s_run(db: Session, run: ClipRun | None) -> dict | None:
    if not run:
        return None
    picked, rejected = services.run_clips(db, run)
    return {"id": run.id, "video_id": run.video_id, "brain": run.brain, "learning_note": run.learning_note,
            "rule_count": len(run.rule_ids or []), "insight_count": len(run.insight_ids or []),
            "mock": run.mock, "created_at": iso(run.created_at),
            "picked": [s_clip(c) for c in picked], "rejected": [s_clip(c) for c in rejected]}


def s_post(p: Post) -> dict:
    return {"id": p.id, "clip_id": p.clip_id, "batch": p.batch, "platform": p.platform,
            "draft_text": p.draft_text, "edited_text": p.edited_text, "text": p.text,
            "hook_style": p.hook_style, "applied_rules": p.applied_rules,
            "scheduled_for": iso(p.scheduled_for), "published_url": p.published_url,
            "published_at": iso(p.published_at), "impressions": p.impressions, "reactions": p.reactions,
            "comments": p.comments, "reposts": p.reposts, "is_external": p.is_external,
            "engagement_rate": round(services.engagement_rate(p) * 100, 2), "created_at": iso(p.created_at)}


def s_rule(r: VoiceRule) -> dict:
    return {"id": r.id, "rule": r.rule, "before": r.before_example, "after": r.after_example,
            "source_post_id": r.source_post_id, "origin": r.origin, "confidence": r.confidence,
            "reinforced": r.reinforced, "active": r.active, "created_at": iso(r.created_at)}


def s_insight(i: Insight) -> dict:
    return {"id": i.id, "finding": i.finding, "evidence": i.evidence, "effect": i.effect,
            "strength": i.strength, "active": i.active, "created_at": iso(i.created_at)}


# ---------- status ----------

@app.get("/api/status")
def status(db: Session = Depends(get_db)):
    return {"llm_mock": config.LLM_MOCK, "whisper_mock": config.WHISPER_MOCK,
            "llm_model": config.LLM_MODEL, "whisper_model": config.WHISPER_MODEL,
            "creator": config.CREATOR_NAME,
            "counts": {"videos": len(db.scalars(select(Video.id)).all()),
                       "rules": len(db.scalars(select(VoiceRule.id).where(VoiceRule.active.is_(True))).all()),
                       "insights": len(db.scalars(select(Insight.id).where(Insight.active.is_(True))).all())}}


# ---------- videos ----------

@app.get("/api/videos")
def list_videos(db: Session = Depends(get_db)):
    return [s_video(v) for v in db.scalars(select(Video).order_by(Video.id.desc()))]


@app.post("/api/videos")
def upload_video(file: UploadFile = File(...), title: str = Form(""), db: Session = Depends(get_db)):
    ext = (Path(file.filename or "video.mp4").suffix or ".mp4").lower()
    if ext not in (".mp4", ".mov", ".mkv", ".webm", ".m4a", ".mp3", ".wav", ".m4v"):
        raise ValueError(f"Unsupported file type {ext}. Use mp4, mov, mkv, webm, mp3, m4a or wav.")
    name = f"{uuid.uuid4().hex[:12]}{ext}"
    dest = config.UPLOADS / name
    with open(dest, "wb") as out:
        while chunk := file.file.read(1024 * 1024):
            out.write(chunk)
    duration, has_video = probe(dest)
    audio = extract_audio(dest)
    segs, lang = transcribe(audio, duration)
    if not segs:
        raise ValueError("No speech found in this file.")
    v = Video(title=title.strip() or Path(file.filename or "Untitled").stem, filename=name,
              has_video=has_video, duration_s=duration or segs[-1]["end"], language=lang or "",
              mock=config.WHISPER_MOCK)
    db.add(v)
    db.flush()
    for i, s in enumerate(segs):
        db.add(Segment(video_id=v.id, idx=i, start_s=s["start"], end_s=s["end"], text=s["text"]))
    db.commit()
    db.refresh(v)
    return s_video(v, segments=True)


@app.get("/api/videos/{vid}")
def get_video(vid: int, db: Session = Depends(get_db)):
    v = db.get(Video, vid) or _404("video")
    return s_video(v, segments=True)


@app.post("/api/videos/{vid}/clips")
def find_clips(vid: int, brain: str = "blank", db: Session = Depends(get_db)):
    if brain not in ("blank", "learned"):
        raise ValueError("brain must be blank or learned")
    v = db.get(Video, vid) or _404("video")
    return s_run(db, services.pick_clips(db, v, brain))


@app.get("/api/videos/{vid}/runs")
def latest_runs(vid: int, db: Session = Depends(get_db)):
    return {"blank": s_run(db, services.latest_run(db, vid, "blank")),
            "learned": s_run(db, services.latest_run(db, vid, "learned"))}


@app.get("/api/videos/{vid}/compare")
def compare(vid: int, db: Session = Depends(get_db)):
    blank, learned = services.latest_run(db, vid, "blank"), services.latest_run(db, vid, "learned")
    if not blank or not learned:
        raise ValueError("Run both the blank and the learned brain first.")
    return services.diff_runs(db, blank, learned)


# ---------- copy and posts ----------

@app.post("/api/clips/{cid}/copy")
def write_copy(cid: int, db: Session = Depends(get_db)):
    c = db.get(Clip, cid) or _404("clip")
    return [s_post(p) for p in services.generate_copy(db, c)]


@app.get("/api/clips/{cid}/posts")
def clip_posts(cid: int, db: Session = Depends(get_db)):
    last = db.scalars(select(Post.batch).where(Post.clip_id == cid).order_by(Post.batch.desc())).first()
    if not last:
        return []
    posts = db.scalars(select(Post).where(Post.clip_id == cid, Post.batch == last).order_by(Post.id))
    return [s_post(p) for p in posts]


@app.get("/api/posts")
def all_posts(db: Session = Depends(get_db)):
    return [s_post(p) for p in db.scalars(select(Post).order_by(Post.id.desc()))]


class EditIn(BaseModel):
    edited_text: str


@app.put("/api/posts/{pid}")
def edit_post(pid: int, body: EditIn, db: Session = Depends(get_db)):
    p = db.get(Post, pid) or _404("post")
    new, reinforced = services.save_edit(db, p, body.edited_text)
    return {"post": s_post(p), "new_rules": [s_rule(r) for r in new], "reinforced": reinforced}


class InstructIn(BaseModel):
    instruction: str


@app.post("/api/posts/{pid}/instruct")
def instruct(pid: int, body: InstructIn, db: Session = Depends(get_db)):
    p = db.get(Post, pid) or _404("post")
    if len(body.instruction.split()) < 2:
        raise ValueError("Say what you want changed, for example: cut the hashtags and make it punchier.")
    post, new = services.instruct_post(db, p, body.instruction.strip())
    db.add(VoiceLog(who=config.CREATOR_NAME, text=f"[in Encore] {body.instruction.strip()}"))
    db.commit()
    return {"post": s_post(post), "new_rules": [s_rule(r) for r in new]}


class PublishIn(BaseModel):
    url: str = ""
    published_at: str | None = None   # local time, ISO, from the browser


def _parse_local(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "")[:19])


@app.post("/api/posts/{pid}/publish")
def publish_post(pid: int, body: PublishIn, db: Session = Depends(get_db)):
    p = db.get(Post, pid) or _404("post")
    p.published_url = body.url.strip()
    p.published_at = _parse_local(body.published_at) or datetime.now()
    db.commit()
    return s_post(p)


class ScheduleIn(BaseModel):
    scheduled_for: str | None = None


@app.put("/api/posts/{pid}/schedule")
def schedule_post(pid: int, body: ScheduleIn, db: Session = Depends(get_db)):
    p = db.get(Post, pid) or _404("post")
    p.scheduled_for = _parse_local(body.scheduled_for)
    db.commit()
    return s_post(p)


class ExternalIn(BaseModel):
    text: str
    url: str = ""
    published_at: str | None = None
    impressions: int = 0
    reactions: int = 0
    comments: int = 0
    reposts: int = 0


@app.post("/api/posts/external")
def add_external(body: ExternalIn, db: Session = Depends(get_db)):
    first = services._first_line(body.text)
    p = Post(clip_id=None, platform="linkedin", draft_text=body.text.strip(), is_external=True,
             hook_style="number" if services.has_number(first) else "", published_url=body.url.strip(),
             published_at=_parse_local(body.published_at) or datetime.now(),
             impressions=body.impressions, reactions=body.reactions,
             comments=body.comments, reposts=body.reposts)
    db.add(p)
    db.commit()
    return s_post(p)


# ---------- Voice DNA ----------

@app.get("/api/voice-rules")
def voice_rules(db: Session = Depends(get_db)):
    return [s_rule(r) for r in db.scalars(select(VoiceRule).order_by(VoiceRule.id.desc()))]


class RulePatch(BaseModel):
    active: bool | None = None
    rule: str | None = None


@app.patch("/api/voice-rules/{rid}")
def patch_rule(rid: int, body: RulePatch, db: Session = Depends(get_db)):
    r = db.get(VoiceRule, rid) or _404("rule")
    if body.active is not None:
        r.active = body.active
    if body.rule:
        r.rule = body.rule.strip()
    db.commit()
    return s_rule(r)


class DescribeIn(BaseModel):
    text: str


@app.post("/api/voice/describe")
def describe(body: DescribeIn, db: Session = Depends(get_db)):
    if len(body.text.split()) < 5:
        raise ValueError("Say a bit more about how you write (a few sentences).")
    return [s_rule(r) for r in services.describe_voice(db, body.text)]


# ---------- performance ----------

@app.post("/api/analytics/xlsx")
def analytics_xlsx(file: UploadFile = File(...), db: Session = Depends(get_db)):
    rows = linkedin.parse_xlsx(file.file.read())
    if not rows:
        raise ValueError("Couldn't find post numbers in this file. Use LinkedIn's analytics Export, "
                         "or type the numbers in by hand.")
    posts = [p for p in db.scalars(select(Post)) if p.published_url]
    by_aid = {linkedin.activity_id(p.published_url): p for p in posts if linkedin.activity_id(p.published_url)}
    matched, unmatched = [], []
    for row in rows:
        p = by_aid.get(row.get("activity_id") or "")
        if p:
            for k in ("impressions", "reactions", "comments", "reposts"):
                if row.get(k):
                    setattr(p, k, int(row[k]))
            matched.append({"post_id": p.id, **row})
        else:
            unmatched.append(row)
    db.commit()
    return {"matched": matched, "unmatched": unmatched}


class NumbersIn(BaseModel):
    post_id: int
    impressions: int = 0
    reactions: int = 0
    comments: int = 0
    reposts: int = 0
    url: str | None = None


class ManualIn(BaseModel):
    entries: list[NumbersIn]


@app.post("/api/analytics/manual")
def analytics_manual(body: ManualIn, db: Session = Depends(get_db)):
    out = []
    for e in body.entries:
        p = db.get(Post, e.post_id)
        if not p:
            continue
        p.impressions, p.reactions, p.comments, p.reposts = e.impressions, e.reactions, e.comments, e.reposts
        if e.url:
            p.published_url = e.url
        if not p.published_at:
            p.published_at = datetime.now()
        out.append(p)
    db.commit()
    return [s_post(p) for p in out]


@app.post("/api/analytics/learn")
def learn(db: Session = Depends(get_db)):
    result = services.analyze_performance(db)
    return {"insights": [s_insight(i) for i in result["insights"]], "diff": result["diff"],
            "video_id": result.get("video_id")}


@app.get("/api/insights")
def insights(db: Session = Depends(get_db)):
    return [s_insight(i) for i in db.scalars(select(Insight).order_by(Insight.id.desc()))]


# ---------- calendar, trace, voice log ----------

@app.get("/api/calendar")
def calendar(db: Session = Depends(get_db)):
    posts = db.scalars(select(Post).where(Post.is_external.is_(False)).order_by(Post.id.desc()))
    return {"suggested": services.calendar_suggestions(db), "posts": [s_post(p) for p in posts]}


@app.get("/api/trace")
def trace(limit: int = 60, db: Session = Depends(get_db)):
    rows = db.scalars(select(Trace).order_by(Trace.id.desc()).limit(limit))
    return [{"id": t.id, "step": t.step, "model": t.model, "input_summary": t.input_summary,
             "output_json": t.output_json, "ms": t.ms, "mock": t.mock, "ok": t.ok,
             "created_at": iso(t.created_at)} for t in rows]


class LogIn(BaseModel):
    text: str
    who: str = ""


@app.get("/api/voice-log")
def voice_log(db: Session = Depends(get_db)):
    rows = list(db.scalars(select(VoiceLog).order_by(VoiceLog.id.desc())))
    shot = next((f.name for f in sorted(config.UPLOADS.glob("flow-stats.*"))), None)
    voice_rules = len(db.scalars(select(VoiceRule.id).where(VoiceRule.origin.in_(["voice", "describe"]))).all())
    return {"entries": [{"id": r.id, "who": r.who, "text": r.text, "created_at": iso(r.created_at)} for r in rows],
            "count": len(rows), "words": sum(len(r.text.split()) for r in rows), "voice_rules": voice_rules,
            "screenshot": f"/media/{shot}" if shot else None}


@app.post("/api/voice-log")
def add_log(body: LogIn, db: Session = Depends(get_db)):
    if not body.text.strip():
        raise ValueError("Empty entry.")
    r = VoiceLog(who=body.who.strip() or config.CREATOR_NAME, text=body.text.strip())
    db.add(r)
    db.commit()
    return {"id": r.id}


@app.post("/api/voice-log/screenshot")
def upload_screenshot(file: UploadFile = File(...)):
    ext = (Path(file.filename or "x.png").suffix or ".png").lower()
    for old in config.UPLOADS.glob("flow-stats.*"):
        old.unlink(missing_ok=True)
    dest = config.UPLOADS / f"flow-stats{ext}"
    dest.write_bytes(file.file.read())
    return {"url": f"/media/{dest.name}"}


# ---------- clip export (optional: a vertical mp4 with captions) ----------

def _srt_time(t: float) -> str:
    t = max(0.0, t)
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02}:{int(m):02}:{int(s):02},{int((s % 1) * 1000):03}"


@app.get("/api/clips/{cid}/export")
def export_clip(cid: int, db: Session = Depends(get_db)):
    c = db.get(Clip, cid) or _404("clip")
    v = db.get(Video, c.video_id)
    src = config.UPLOADS / v.filename
    segs = db.scalars(select(Segment).where(Segment.video_id == v.id, Segment.idx >= c.start_seg,
                                            Segment.idx <= c.end_seg).order_by(Segment.idx)).all()
    srt = config.UPLOADS / f"clip{c.id}.srt"
    srt.write_text("\n".join(f"{i}\n{_srt_time(s.start_s - c.start_s)} --> {_srt_time(s.end_s - c.start_s)}\n{s.text}\n"
                             for i, s in enumerate(segs, 1)), encoding="utf-8")
    dur = f"{c.end_s - c.start_s:.2f}"
    base = [ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{c.start_s:.2f}", "-i", src.name, "-t", dur]
    if v.has_video:
        out = config.UPLOADS / f"encore-clip-{c.id}.mp4"
        crop = "crop='min(iw,ih*9/16)':ih,scale=1080:1920"
        style = "FontName=Arial,FontSize=13,Bold=1,Outline=2,Shadow=0,Alignment=2,MarginV=70"
        enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", out.name]
        attempts = [base + ["-vf", f"{crop},subtitles={srt.name}:force_style='{style}'"] + enc, base + ["-vf", crop] + enc]
    else:
        out = config.UPLOADS / f"encore-clip-{c.id}.m4a"
        attempts = [base + ["-vn", "-c:a", "aac", "-b:a", "128k", out.name]]
    err = ""
    for cmd in attempts:
        proc = subprocess.run(cmd, cwd=config.UPLOADS, capture_output=True, text=True, errors="ignore")
        if proc.returncode == 0 and out.exists():
            return FileResponse(out, filename=out.name)
        err = proc.stderr[-300:]
    raise RuntimeError(f"Export failed: {err}")


# ---------- media with range requests (so the browser can seek) ----------

@app.get("/media/{name}")
def media(name: str, request: Request):
    if not re.fullmatch(r"[\w.\-]+", name):
        _404("file")
    path = config.UPLOADS / name
    if not path.is_file():
        _404("file")
    size = path.stat().st_size
    ctype = {".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
             ".mkv": "video/x-matroska", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
             ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}.get(path.suffix.lower(),
                                                                                "application/octet-stream")
    rng = request.headers.get("range")
    if not rng:
        return FileResponse(path, media_type=ctype, headers={"Accept-Ranges": "bytes"})
    m = re.match(r"bytes=(\d*)-(\d*)", rng)
    start = int(m.group(1)) if m and m.group(1) else 0
    end = int(m.group(2)) if m and m.group(2) else size - 1
    end = min(end, size - 1)
    if start > end:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
    length = end - start + 1

    def body():
        with open(path, "rb") as f:
            f.seek(start)
            left = length
            while left > 0:
                chunk = f.read(min(1024 * 512, left))
                if not chunk:
                    break
                left -= len(chunk)
                yield chunk

    return StreamingResponse(body(), status_code=206, media_type=ctype, headers={
        "Content-Range": f"bytes {start}-{end}/{size}", "Accept-Ranges": "bytes",
        "Content-Length": str(length)})


def _404(what: str):
    raise HTTPException(404, f"{what} not found")


# ---------- the built frontend ----------

if (config.STATIC / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=config.STATIC / "assets"), name="assets")


@app.get("/{path:path}")
def spa(path: str):
    index = config.STATIC / "index.html"
    if path.startswith("api/"):
        _404("route")
    candidate = config.STATIC / path
    if path and candidate.is_file():
        return FileResponse(candidate)
    if index.is_file():
        return FileResponse(index)
    return JSONResponse({"detail": "Frontend not built. Run: cd frontend && npm install && npm run build"}, 404)

"""Encore's brain: picking clips, writing copy, learning a voice, learning from results."""
import json
import re
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import config
from .db import Clip, ClipRun, Insight, Post, Segment, Video, VoiceRule, now
from .llm import chat_json, load_prompt

PLATFORMS = ["linkedin", "x_thread", "reels_caption", "shorts_title"]
NUMBER_WORDS = r"\b(one|two|three|four|five|six|seven|eight|nine|ten|twice|half|hundred|thousand)\b"


# ---------- helpers ----------

def active_rules(db: Session) -> list[VoiceRule]:
    return list(db.scalars(select(VoiceRule).where(VoiceRule.active.is_(True)).order_by(VoiceRule.id)))


def active_insights(db: Session) -> list[Insight]:
    return list(db.scalars(select(Insight).where(Insight.active.is_(True)).order_by(Insight.id)))


def clip_settings(duration: float) -> tuple[int, int, int]:
    """(clips wanted, min seconds, max seconds) for a video of this length."""
    if duration < 240:
        return 3, 14, 60
    if duration < 900:
        return 5, 20, 90
    return 6, 30, 90


def has_number(text: str) -> bool:
    return bool(re.search(r"\d", text) or re.search(NUMBER_WORDS, text, re.I))


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "").strip().lower())


def engagement_rate(p: Post) -> float:
    return (p.reactions + p.comments + p.reposts) / p.impressions if p.impressions else 0.0


# ---------- 1. clip picking ----------

def _fit_window(segs: list[Segment], s: int, e: int, mn: float, mx: float) -> tuple[int, int]:
    last = len(segs) - 1
    s, e = max(0, min(s, last)), max(0, min(e, last))
    if e < s:
        s, e = e, s
    while segs[e].end_s - segs[s].start_s < mn and e < last:
        e += 1
    while segs[e].end_s - segs[s].start_s < mn and s > 0:
        s -= 1
    while segs[e].end_s - segs[s].start_s > mx and e > s:
        e -= 1
    return s, e


def _overlaps(a: tuple[float, float], b: tuple[float, float]) -> float:
    inter = max(0.0, min(a[1], b[1]) - max(a[0], b[0]))
    shorter = max(0.01, min(a[1] - a[0], b[1] - b[0]))
    return inter / shorter


def _mock_pick(segs: list[Segment], n: int, mn: float, mx: float, insights: list[Insight]) -> dict:
    """Deterministic heuristic picker used in demo mode. It reacts to insights, like the real one."""
    wants_numbers = any("number" in (i.finding + i.effect).lower() for i in insights)
    contrarian = re.compile(r"\b(nobody|not|never|honestly|the thing|truth|actually|dream|rule)\b", re.I)
    weak_start = re.compile(r"^(and|so|but|that|like|okay|alright|yeah)\b", re.I)
    candidates = []
    for i in range(len(segs)):
        s, e = _fit_window(segs, i, i, mn, mx)
        first = segs[s].text
        body = " ".join(x.text for x in segs[s:e + 1])
        num, contra, weak = has_number(first), bool(contrarian.search(body)), bool(weak_start.match(first))
        hook = 58 + (20 if num else 0) + (10 if contra else 0) - (18 if weak else 0)
        standalone = 82 - (25 if weak else 0)
        energy = 60 + min(25, body.count(",") * 4 + body.count("!") * 6)
        quotable = 62 + (14 if contra else 0) + (8 if len(first) < 90 else 0)
        fit = (92 if num else 38) if wants_numbers else 50
        score = round(0.25 * hook + 0.2 * standalone + 0.15 * energy + 0.15 * quotable + 0.25 * fit)
        reasons = []
        if num:
            reasons.append("opens with a concrete number")
        if contra:
            reasons.append("contrarian line people quote")
        if not weak:
            reasons.append("first line stands on its own")
        if wants_numbers and num:
            reasons.append("matches your best-performing hook style")
        if not reasons:
            reasons.append("clear single idea")
        candidates.append(dict(start_seg=s, end_seg=e, score=score, weak=weak,
                               scores=dict(hook=hook, standalone=standalone, energy=energy,
                                           quotability=quotable, fit=fit),
                               reasons=reasons[:4], hook_line=first,
                               title=" ".join(first.split()[:7]).rstrip(".,") + "…"))
    candidates.sort(key=lambda c: -c["score"])
    picked, rejected = [], []
    for c in candidates:
        span = (segs[c["start_seg"]].start_s, segs[c["end_seg"]].end_s)
        if any(_overlaps(span, (segs[p["start_seg"]].start_s, segs[p["end_seg"]].end_s)) > 0.3 for p in picked):
            continue
        if len(picked) < n and not c["weak"]:
            c["editor_note"] = (f"Strong opener and it fits what worked for you before."
                                if wants_numbers and c["scores"]["fit"] > 80
                                else "Self-contained moment with a clear payoff in under a minute.")
            picked.append(c)
    for c in reversed(candidates):
        if len(rejected) >= 3:
            break
        if any(c["start_seg"] == p["start_seg"] for p in picked):
            continue
        why = ("starts mid-thought, needs earlier context" if c["weak"]
               else "no clear hook in the first line")
        rejected.append(dict(start_seg=c["start_seg"], end_seg=c["end_seg"], title=c["title"], why=why))
    note = None
    if insights:
        note = ("Moved number-first openers up, because your number-led post outperformed."
                if wants_numbers else f"Re-ranked using what performed: {insights[0].effect[:120]}")
    return {"picked": picked, "rejected": rejected, "learning_note": note}


CHUNK_TOKENS = 4200          # keeps each request well under Groq's free-tier 8,000 tokens/minute


def _est_tokens(text: str) -> int:
    return int(len(text) / 3.2) + 1


def _seg_line(s: Segment) -> str:
    return f"[{s.idx}] {s.start_s:.0f}s {s.text}"


def _chunks(segs: list[Segment]) -> list[list[Segment]]:
    out, cur, size = [], [], 0
    for s in segs:
        t = _est_tokens(_seg_line(s))
        if cur and size + t > CHUNK_TOKENS:
            out.append(cur)
            cur, size = [], 0
        cur.append(s)
        size += t
    if cur:
        out.append(cur)
    return out


def _pick_request(segs: list[Segment], n: int, mn: int, mx: int, rules, insights) -> str:
    return json.dumps({
        "creator": config.CREATOR_NAME, "clips_wanted": n, "min_seconds": mn, "max_seconds": mx,
        "segments": [_seg_line(s) for s in segs],
        "voice_rules": [r.rule for r in rules],
        "insights": [{"finding": i.finding, "effect": i.effect} for i in insights],
    }, ensure_ascii=False)


def _to_global(data: dict, part: list[Segment]) -> dict:
    for key in ("picked", "rejected"):
        for c in data.get(key) or []:
            c["start_seg"], c["end_seg"] = part[c["start_seg"]].idx, part[c["end_seg"]].idx
    return data


def pick_clips(db: Session, video: Video, brain: str) -> ClipRun:
    segs = list(video.segments)
    if not segs:
        raise ValueError("This video has no transcript yet.")
    n, mn, mx = clip_settings(video.duration_s or segs[-1].end_s)
    rules = active_rules(db) if brain == "learned" else []
    insights = active_insights(db) if brain == "learned" else []
    chunks = _chunks(segs)
    if len(chunks) == 1:
        data = chat_json(
            f"pick_clips ({brain} brain)", load_prompt("clip_picker.md"),
            _pick_request(segs, n, mn, mx, rules, insights),
            summary=f"{len(segs)} segments, wants {n} clips of {mn}-{mx}s, "
                    f"{len(rules)} voice rules, {len(insights)} insights",
            mock=lambda: _mock_pick(segs, n, mn, mx, insights), effort="medium")
    else:
        # Long video: pick candidates per chunk (alternating models so each stays inside its
        # per-minute token budget), then keep the best non-overlapping ones overall.
        per = max(2, -(-n * 3 // (2 * len(chunks))))
        data = {"picked": [], "rejected": [], "learning_note": None}
        for i, part in enumerate(chunks):
            model = config.LLM_MODEL if i % 2 == 0 else (config.LLM_FALLBACK_MODEL or config.LLM_MODEL)
            got = chat_json(
                f"pick_clips ({brain} brain) part {i + 1}/{len(chunks)}", load_prompt("clip_picker.md"),
                _pick_request(part, per, mn, mx, rules, insights),
                summary=f"segments {part[0].idx}-{part[-1].idx} of {len(segs)}, wants {per} candidates, "
                        f"{len(rules)} voice rules, {len(insights)} insights",
                mock=lambda part=part: _to_global(_mock_pick(part, per, mn, mx, insights), part),
                effort="low", model=model)
            data["picked"] += got.get("picked") or []
            data["rejected"] += (got.get("rejected") or [])[:1]
            data["learning_note"] = data["learning_note"] or got.get("learning_note")
        data["picked"].sort(key=lambda p: -float(p.get("score") or 0))

    run = ClipRun(video_id=video.id, brain=brain, learning_note=data.get("learning_note") or "",
                  rule_ids=[r.id for r in rules], insight_ids=[i.id for i in insights],
                  mock=config.LLM_MOCK)
    db.add(run)
    db.flush()

    taken: list[tuple[float, float]] = []
    rank = 0
    for p in data.get("picked") or []:
        try:
            s, e = _fit_window(segs, int(p["start_seg"]), int(p["end_seg"]), mn, mx)
        except (KeyError, TypeError, ValueError):
            continue
        span = (segs[s].start_s, segs[e].end_s)
        if any(_overlaps(span, t) > 0.5 for t in taken) or rank >= n:
            continue
        taken.append(span)
        rank += 1
        db.add(Clip(run_id=run.id, video_id=video.id, status="picked", rank=rank,
                    start_seg=s, end_seg=e, start_s=span[0], end_s=span[1],
                    title=str(p.get("title") or segs[s].text[:60]),
                    score=max(0.0, min(100.0, float(p.get("score") or 0))),
                    scores={k: float(v) for k, v in (p.get("scores") or {}).items()
                            if isinstance(v, (int, float))},
                    reasons=[str(x) for x in (p.get("reasons") or [])][:4],
                    editor_note=str(p.get("editor_note") or ""),
                    hook_line=str(p.get("hook_line") or segs[s].text)))
    for r in (data.get("rejected") or [])[:4]:
        try:
            s, e = _fit_window(segs, int(r["start_seg"]), int(r["end_seg"]), 0, mx)
        except (KeyError, TypeError, ValueError):
            continue
        db.add(Clip(run_id=run.id, video_id=video.id, status="rejected", rank=0,
                    start_seg=s, end_seg=e, start_s=segs[s].start_s, end_s=segs[e].end_s,
                    title=str(r.get("title") or segs[s].text[:60]), why=str(r.get("why") or "")))
    if rank == 0:
        db.rollback()
        raise ValueError("The AI returned no usable clips. Try again.")
    db.commit()
    return run


def run_clips(db: Session, run: ClipRun) -> tuple[list[Clip], list[Clip]]:
    clips = list(db.scalars(select(Clip).where(Clip.run_id == run.id).order_by(Clip.rank)))
    return [c for c in clips if c.status == "picked"], [c for c in clips if c.status == "rejected"]


def latest_run(db: Session, video_id: int, brain: str) -> ClipRun | None:
    return db.scalars(select(ClipRun).where(ClipRun.video_id == video_id, ClipRun.brain == brain)
                      .order_by(ClipRun.id.desc())).first()


def diff_runs(db: Session, old: ClipRun, new: ClipRun) -> dict:
    old_picked, _ = run_clips(db, old)
    new_picked, _ = run_clips(db, new)
    used: set[int] = set()
    rows = []
    for c in new_picked:
        best, best_ov = None, 0.0
        for o in old_picked:
            if o.id in used:
                continue
            ov = _overlaps((c.start_s, c.end_s), (o.start_s, o.end_s))
            if ov > best_ov:
                best, best_ov = o, ov
        if best is not None and best_ov >= 0.4:
            used.add(best.id)
            move = best.rank - c.rank
            status = "up" if move > 0 else "down" if move < 0 else "same"
            rows.append(dict(clip_id=c.id, title=c.title, new_rank=c.rank, old_rank=best.rank,
                             move=move, status=status, reason=(c.reasons or [c.editor_note])[0]))
        else:
            rows.append(dict(clip_id=c.id, title=c.title, new_rank=c.rank, old_rank=None, move=None,
                             status="new", reason=(c.reasons or [c.editor_note])[0]))
    dropped = [dict(clip_id=o.id, title=o.title, old_rank=o.rank) for o in old_picked if o.id not in used]
    return {"from_run": old.id, "from_brain": old.brain, "to_run": new.id, "to_brain": new.brain,
            "learning_note": new.learning_note, "rows": rows, "dropped": dropped}


# ---------- 2. platform copy ----------

def clip_transcript(db: Session, clip: Clip) -> str:
    segs = db.scalars(select(Segment).where(Segment.video_id == clip.video_id,
                                            Segment.idx >= clip.start_seg,
                                            Segment.idx <= clip.end_seg).order_by(Segment.idx))
    return " ".join(s.text for s in segs)


def _mock_copy(clip: Clip, transcript: str, rules: list[VoiceRule]) -> dict:
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", transcript) if s.strip()]
    hook = clip.hook_line or (sentences[0] if sentences else clip.title)
    rest = [s for s in sentences if s != hook][:3]
    rule_text = " ".join(r.rule.lower() for r in rules)
    emoji = "" if "emoji" in rule_text else " 🎬"
    tags = "#buildinpublic #creators" if "hashtag" in rule_text else "#buildinpublic #creators #hackathon"
    linkedin = f"{hook}\n\n" + "\n\n".join(rest) + f"\n\nThat's the part most people skip.{emoji}\n\nWhat would you do differently?\n\n{tags}"
    for r in rules:
        m = re.search(r"never use the word ['\"]?([\w-]+)", r.rule, re.I)
        if m:
            linkedin = re.sub(rf"(?<![\w']){re.escape(m.group(1))}(?![\w'])\s?", "", linkedin, flags=re.I)
    thread = [hook] + rest[:2] + ["That's the loop. Record once, post all week."]
    applied = [{"rule_id": r.id, "platform": "linkedin", "where": hook} for r in rules[:2]]
    return {"linkedin": linkedin, "x_thread": thread,
            "reels_caption": f"{hook[:110]}\n{tags}",
            "shorts_title": (clip.title or hook)[:58],
            "hook_style": "number" if has_number(hook) else "story",
            "applied_rules": applied}


def generate_copy(db: Session, clip: Clip) -> list[Post]:
    rules = active_rules(db)
    insights = active_insights(db)
    transcript = clip_transcript(db, clip)
    user = json.dumps({
        "creator": config.CREATOR_NAME, "clip_title": clip.title, "clip_transcript": transcript,
        "voice_rules": [{"id": r.id, "rule": r.rule} for r in rules],
        "insights": [{"finding": i.finding, "effect": i.effect} for i in insights],
    }, ensure_ascii=False)
    data = chat_json("write_copy", load_prompt("platform_copy.md"), user,
                     summary=f"clip #{clip.id} '{clip.title}', {len(transcript.split())} words, "
                             f"{len(rules)} voice rules, {len(insights)} insights",
                     mock=lambda: _mock_copy(clip, transcript, rules), temperature=0.7, effort="low")
    rule_ids = {r.id for r in rules}
    last = db.scalars(select(Post.batch).where(Post.clip_id == clip.id).order_by(Post.batch.desc())).first()
    batch = (last or 0) + 1
    posts = []
    for platform in PLATFORMS:
        val = data.get(platform) or ""
        if isinstance(val, list):
            val = "\n\n".join(f"{i}/ {str(t).strip()}" for i, t in enumerate(val, 1))
        applied = []
        for a in data.get("applied_rules") or []:
            try:
                rid = int(a.get("rule_id"))
            except (TypeError, ValueError):
                continue
            if rid in rule_ids and (a.get("platform") or "linkedin") == platform:
                applied.append({"rule_id": rid, "where": str(a.get("where") or "")})
        p = Post(clip_id=clip.id, batch=batch, platform=platform, draft_text=str(val).strip(),
                 hook_style=str(data.get("hook_style") or "")[:30], applied_rules=applied)
        db.add(p)
        posts.append(p)
    db.commit()
    return posts


# ---------- 3. Voice DNA ----------

STOP = set("the a an and or but so to of in on for with is are was were be been it this that i we you they my our "
           "your just really very about from at as by have has had do did not no yes can will would".split())


def _mock_dna(draft: str, edited: str, rules: list[VoiceRule]) -> dict:
    existing = " ".join(r.rule.lower() for r in rules)
    out = []
    emo = re.compile(r"[\U0001F300-\U0001FAFF☀-➿]")
    if emo.search(draft) and not emo.search(edited) and "emoji" not in existing:
        out.append({"rule": "Cut all emojis", "before": emo.search(draft).group(0), "after": "(removed)", "confidence": 0.85})
    d_words = re.findall(r"[A-Za-z']+", draft.lower())
    e_words = set(re.findall(r"[A-Za-z']+", edited.lower()))
    removed = [w for w in dict.fromkeys(d_words)
               if w not in e_words and w not in STOP and len(w) > 4 and "'" not in w]
    if removed and f"'{removed[0]}'" not in existing:
        out.append({"rule": f"Never use the word '{removed[0]}'", "before": removed[0], "after": "(cut)", "confidence": 0.75})
    d_first, e_first = (draft.strip().split("\n") or [""])[0], (edited.strip().split("\n") or [""])[0]
    if has_number(e_first) and not has_number(d_first) and "number" not in existing:
        out.append({"rule": "Open with a concrete number", "before": d_first[:80], "after": e_first[:80], "confidence": 0.8})
    if draft.count("#") > edited.count("#") and "hashtag" not in existing:
        out.append({"rule": f"Use at most {edited.count('#')} hashtags", "before": f"{draft.count('#')} hashtags",
                    "after": f"{edited.count('#')} hashtags", "confidence": 0.7})
    if len(edited) < 0.8 * len(draft) and "tight" not in existing:
        out.append({"rule": "Keep it tight: cut filler sentences", "before": f"{len(draft.split())} words",
                    "after": f"{len(edited.split())} words", "confidence": 0.65})
    if not out:
        out.append({"rule": "Prefer plain, spoken phrasing over polished marketing lines",
                    "before": d_first[:80], "after": e_first[:80], "confidence": 0.55})
    return {"new_rules": out[:3], "reinforces": []}


def _store_rules(db: Session, items: list, origin: str, source_post_id: int | None) -> list[VoiceRule]:
    existing = {_norm(r.rule) for r in db.scalars(select(VoiceRule))}
    new = []
    for item in items[:5]:
        text = str((item or {}).get("rule") or "").strip()
        if not text or _norm(text) in existing:
            continue
        existing.add(_norm(text))
        try:
            conf = float(item.get("confidence", 0.7))
        except (TypeError, ValueError):
            conf = 0.7
        r = VoiceRule(rule=text, before_example=str(item.get("before") or "")[:400],
                      after_example=str(item.get("after") or "")[:400], source_post_id=source_post_id,
                      origin=origin, confidence=max(0.0, min(1.0, conf)))
        db.add(r)
        new.append(r)
    return new


def save_edit(db: Session, post: Post, edited: str) -> tuple[list[VoiceRule], list[int]]:
    post.edited_text = edited
    db.commit()
    if _norm(edited) == _norm(post.draft_text):
        return [], []
    rules = active_rules(db)
    user = json.dumps({"draft": post.draft_text, "edited": edited,
                       "existing_rules": [{"id": r.id, "rule": r.rule} for r in rules]}, ensure_ascii=False)
    data = chat_json("learn_voice", load_prompt("voice_dna.md"), user,
                     summary=f"post #{post.id} ({post.platform}): draft {len(post.draft_text.split())} words, "
                             f"edit {len(edited.split())} words, {len(rules)} existing rules",
                     mock=lambda: _mock_dna(post.draft_text, edited, rules), temperature=0.2, effort="low")
    new = _store_rules(db, data.get("new_rules") or [], "edit", post.id)
    reinforced = []
    by_id = {r.id: r for r in rules}
    for rid in data.get("reinforces") or []:
        try:
            r = by_id.get(int(rid))
        except (TypeError, ValueError):
            r = None
        if r:
            r.reinforced += 1
            reinforced.append(r.id)
    db.commit()
    return new, reinforced


def _mock_describe(text: str) -> dict:
    out = []
    t = text.lower()
    if "short" in t:
        out.append({"rule": "Short sentences, written the way I talk", "after": "short", "confidence": 0.7})
    if "emoji" in t:
        out.append({"rule": "No emojis", "after": "emoji", "confidence": 0.7})
    if "story" in t or "personal" in t:
        out.append({"rule": "Open with a personal story", "after": "story", "confidence": 0.7})
    if "hinglish" in t or "hindi" in t:
        out.append({"rule": "Mix in a Hinglish phrase in casual posts", "after": "Hinglish", "confidence": 0.7})
    if not out:
        out.append({"rule": "Write the way I speak: direct, simple, no jargon", "after": text[:80], "confidence": 0.6})
    return {"new_rules": out}


def describe_voice(db: Session, text: str) -> list[VoiceRule]:
    rules = active_rules(db)
    user = json.dumps({"description": text, "existing_rules": [r.rule for r in rules]}, ensure_ascii=False)
    data = chat_json("describe_voice", load_prompt("describe_voice.md"), user,
                     summary=f"spoken description, {len(text.split())} words",
                     mock=lambda: _mock_describe(text), temperature=0.2, effort="low")
    new = _store_rules(db, data.get("new_rules") or [], "describe", None)
    db.commit()
    return new


def _mock_instruct(text: str, instruction: str) -> dict:
    t = instruction.lower()
    out, rules = text, []
    if "emoji" in t:
        out = re.sub(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]\s?", "", out)
        rules.append({"rule": "Cut all emojis", "confidence": 0.9})
    if "hashtag" in t:
        out = re.sub(r"\s*#\w+", "", out).rstrip()
        rules.append({"rule": "No hashtags", "confidence": 0.85})
    if any(w in t for w in ("short", "punch", "concise", "tight", "chhota")):
        lines = [ln for ln in out.split("\n") if ln.strip()]
        out = "\n\n".join(lines[:max(2, len(lines) - 2)])
        rules.append({"rule": "Keep posts short and punchy", "confidence": 0.75})
    if "number" in t:
        rules.append({"rule": "Open with a concrete number", "confidence": 0.8})
    if "question" in t:
        out = "\n".join(ln for ln in out.split("\n") if not ln.strip().endswith("?")).strip()
        rules.append({"rule": "Never end with a question", "confidence": 0.8})
    return {"rewritten": out, "new_rules": rules}


def instruct_post(db: Session, post: Post, instruction: str) -> tuple[Post, list[VoiceRule]]:
    rules = active_rules(db)
    current = post.text
    user = json.dumps({"post": current, "platform": post.platform, "instruction": instruction,
                       "existing_rules": [r.rule for r in rules]}, ensure_ascii=False)
    data = chat_json("voice_instruction", load_prompt("voice_instruct.md"), user,
                     summary=f'post #{post.id} ({post.platform}), spoken: "{instruction[:120]}"',
                     mock=lambda: _mock_instruct(current, instruction), temperature=0.4, effort="low")
    post.edited_text = str(data.get("rewritten") or "").strip() or current
    items = [{"rule": (r or {}).get("rule"), "before": "", "after": f'You said: "{instruction[:160]}"',
              "confidence": (r or {}).get("confidence", 0.8)} for r in (data.get("new_rules") or [])]
    new = _store_rules(db, items, "voice", post.id)
    db.commit()
    return post, new


# ---------- 4. performance loop ----------

def _first_line(text: str) -> str:
    return next((ln for ln in text.strip().split("\n") if ln.strip()), "")


def _mock_performance(posts: list[Post]) -> dict:
    ranked = sorted(posts, key=lambda p: (engagement_rate(p) * 100 + p.impressions / 1000), reverse=True)
    best, worst = ranked[0], ranked[-1]
    b_rate, w_rate = engagement_rate(best) * 100, engagement_rate(worst) * 100
    num = has_number(_first_line(best.text))
    if len(posts) == 1:
        return {"insights": [{
            "finding": ("Number-first opener got the strongest early signal" if num
                        else f"Early signal from post #{best.id}"),
            "evidence": f"Post #{best.id}: {best.impressions} impressions, {b_rate:.1f}% engagement.",
            "effect": ("Rank clips whose first line has a concrete number higher; open posts with the number."
                       if num else f"Keep the opening style of post #{best.id}."),
            "strength": "early"}]}
    if num and not has_number(_first_line(worst.text)):
        finding = "Number-first hooks beat the rest"
    elif len(best.text) < len(worst.text):
        finding = f"Shorter post #{best.id} beat longer post #{worst.id}"
    else:
        finding = f"The opening style of post #{best.id} beat post #{worst.id}"
    effect = ("Rank clips whose first line has a concrete number higher; open LinkedIn posts with that number."
              if num else f"Favour clips and openings like post #{best.id}.")
    return {"insights": [{
        "finding": finding,
        "evidence": (f"Post #{best.id}: {best.impressions} impressions, {b_rate:.1f}% engagement. "
                     f"Post #{worst.id}: {worst.impressions} impressions, {w_rate:.1f}%."),
        "effect": effect, "strength": "early" if len(posts) < 5 else "solid"}]}


def analyze_performance(db: Session) -> dict:
    posts = list(db.scalars(select(Post).where(Post.impressions > 0).order_by(Post.id)))
    if not posts:
        raise ValueError("Add numbers for at least one published post first.")
    payload = [{"id": p.id, "text": p.text[:1500], "platform": p.platform, "hook_style": p.hook_style,
                "length_words": len(p.text.split()),
                "posted_hour": p.published_at.hour if p.published_at else None,
                "impressions": p.impressions, "reactions": p.reactions,
                "comments": p.comments, "reposts": p.reposts} for p in posts]
    data = chat_json("learn_performance", load_prompt("performance.md"),
                     json.dumps({"posts": payload}, ensure_ascii=False),
                     summary=f"{len(posts)} posts with real numbers, "
                             f"{sum(p.impressions for p in posts)} total impressions",
                     mock=lambda: _mock_performance(posts), temperature=0.2, effort="medium")
    for old in active_insights(db):
        old.active = False
    new = []
    for i in (data.get("insights") or [])[:3]:
        if not i or not i.get("finding"):
            continue
        ins = Insight(finding=str(i["finding"]), evidence=str(i.get("evidence") or ""),
                      effect=str(i.get("effect") or ""), strength=str(i.get("strength") or "early")[:20])
        db.add(ins)
        new.append(ins)
    db.commit()

    result: dict = {"insights": new, "diff": None}
    video = db.scalars(select(Video).order_by(Video.id.desc())).first()
    if video and video.segments:
        before = latest_run(db, video.id, "learned") or latest_run(db, video.id, "blank")
        after = pick_clips(db, video, "learned")
        result["video_id"] = video.id
        result["diff"] = diff_runs(db, before, after) if before else None
    return result


def calendar_suggestions(db: Session) -> dict:
    pubs = [p for p in db.scalars(select(Post).where(Post.impressions > 0)) if p.published_at]
    if len(pubs) >= 2:
        best = sorted(pubs, key=engagement_rate, reverse=True)
        hours = list(dict.fromkeys(p.published_at.hour for p in best))[:3]
        return {"hours": hours, "source": "from your results"}
    return {"hours": [9, 13, 18], "source": "default until you have results"}

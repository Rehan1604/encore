# Encore spec

Problem statement 01: a content repurposing studio with brand memory.

## The user
A creator who records long videos (podcasts, talks, build logs) and wants a week of posts from each one, in their own voice.

## Required features
1. Long video or podcast ingestion: upload, audio extraction, Whisper transcript with timestamps.
2. Clip selection with reasons: picked clips with scores, reasons and an editor's note, plus rejected moments with the reason.
3. Captions and copy per platform: LinkedIn, X thread, Reels caption, Shorts title. Captions over the clip preview.
4. Brand-voice memory that learns from edits: edit, compare with the draft, extract rules, apply them to every later draft, highlight where they were applied.
5. Content calendar: a week view, drag to schedule, slots suggested from past results.
6. Performance feedback loop: LinkedIn .xlsx or manual numbers in, insights with evidence out, clips re-ranked, and a "What changed" panel.

## Extras
- Blank brain vs learned brain on the same video
- AI trace of every model call
- Built-with-voice page and log
- Describe-your-voice box for starting rules

## Data
videos, segments, clip_runs, clips, posts, voice_rules, insights, trace, voice_log

## Rules
- Every AI call returns strict JSON and is traced.
- Never invent numbers. Never post on the user's behalf.
- Demo mode is always labelled.

# Encore

**Record once. Post all week. Sound like yourself every time.**

Encore turns one long video into short clips, captions and posts for every platform. Clip tools pick moments that are viral for an average audience. Encore learns from two things only the creator has: **the edits they make** and **the real numbers their posts get**. Every edit becomes a rule in the creator's Voice DNA, and every LinkedIn export changes what Encore picks next.

> Every LinkedIn post we published during the hackathon was written by Encore, and the engagement on those posts trained it.

---

## What it does

| Feature | How it works |
| --- | --- |
| **Long video ingestion** | Upload mp4, mov, webm, mp3 or m4a. ffmpeg pulls a small mono audio track, and Whisper (`whisper-large-v3-turbo` on Groq) returns a timestamped transcript. |
| **Clip selection with reasons** | The LLM scores every candidate moment on hook, standalone clarity, energy, quotability and fit to the creator. Every clip shows its reasons and an editor's note, plus **the moments Encore rejected and why**. Clips play in a 9:16 preview with word-by-word captions. |
| **Platform copy** | One clip becomes a LinkedIn post, an X thread, a Reels caption and a Shorts title, each written to that platform's rules. |
| **Brand-voice memory (Voice DNA)** | When you edit a draft, or tell Encore out loud what to change, it writes down your preference as a rule ("Open with a number", "Never use the word 'excited'"). Every later draft follows the rules, and the sentences where a rule was applied are highlighted. |
| **Content calendar** | Drag drafts onto a week view. Suggested time slots come from when your own posts performed best. |
| **Performance feedback loop** | Upload your LinkedIn analytics export (.xlsx) or type the numbers. Encore finds what drove performance, with the evidence, and re-ranks your clips. A **What changed** panel shows which clips moved and why. |
| **Blank brain vs learned brain** | Run the same video through a brain that knows nothing about you and one that knows your edits and your numbers, side by side. |
| **AI trace** | Every model call, with its inputs, its output and its timing. No black box. |

## How we built it by voice

We built Encore in a 9-hour hackathon by directing an AI coding agent by voice. From 3:40 pm onward, every instruction to the agent, every edit, every LinkedIn post and this submission were dictated with **Wispr Flow**, including prompts in Hinglish. We used Flow's **Command Mode** to rewrite drafts by voice, its **personal dictionary** for our project terms, and **snippets** for our pitch line.

Voice is also how you steer Encore:

- **Tell Encore what to change:** speak an instruction ("cut the hashtags, open with the number"). Encore rewrites the post and turns what you said into a Voice DNA rule.
- **Edit by voice:** dictate or Command-Mode an edit, and Encore learns a rule from what changed.
- **Describe your voice:** talk for a minute about how you write, and get starting rules.

The **Built with voice** page logs the prompts we spoke and shows our Flow stats. `VOICE_LOG.md` has the list.

## Run it (Windows)

1. Get a free API key at <https://console.groq.com/keys>. One key covers Whisper and the LLM.
2. Double-click `start.bat`. The first run creates `.env`, installs packages and opens <http://localhost:8000>.
3. Open `.env`, paste your key after `GROQ_API_KEY=`, save, and run `start.bat` again.

Mac or Linux: `./start.sh`. You need Python 3.10 or newer. ffmpeg is bundled through `imageio-ffmpeg`, so there is nothing else to install.

Without a key, Encore runs in **demo mode**: a sample transcript and heuristic picks, clearly labelled in the sidebar and in the AI trace.

### Rebuilding the frontend (optional)

The built UI ships in `backend/static`. To change it: `cd frontend && npm install && npm run dev` (hot reload on :5173, with the API proxied to :8000), then `npm run build`.

## Architecture

```
React + Vite + Tailwind  ──>  FastAPI  ──>  Groq Whisper        (transcript)
     (backend/static)            │     ──>  Groq gpt-oss-120b   (clip picker, copy, Voice DNA, analyst)
                                 └──>  SQLite locally, Postgres (Neon) when deployed
```

- `backend/app/services.py`: the brain (picking clips, writing copy, learning voice rules, learning from results)
- `backend/app/prompts/`: the five prompts, each returning strict JSON
- `backend/app/linkedin.py`: reads LinkedIn analytics exports by scanning for headers, so both the all-posts and single-post exports work
- `backend/app/llm.py`: one JSON-mode call with retries, a fallback model for free-tier limits, and a trace row for every call

## Honesty notes

- The analyst only reports numbers that are in your data, and labels findings "early" when there are fewer than 5 posts.
- Encore never posts on your behalf. You publish, then paste the URL.
- Demo mode is always labelled.

## Deploy

`Dockerfile` runs the whole app (API and UI) on one port. On Render, create a Docker web service from this repo and set `GROQ_API_KEY`. Set `DATABASE_URL` to a Neon Postgres URL if you want data to survive restarts.

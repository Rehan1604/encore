import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Brain, ChevronDown, Download, Film, Pause, PenLine, Play, Plus, Sparkles, Upload, X } from "lucide-react";
import { api, Clip, Diff, Run, Segment, uploadVideo, Video, fmtTime } from "../api";
import { Button, Card, Chip, cx, PageHeader, ScoreRing, useToast } from "../ui";
import CopyPanel from "./CopyPanel";

type Mode = "blank" | "learned" | "compare";
const STAGES = ["Uploading", "Listening with Whisper", "Finding moments", "Picking clips"];

/* ---------------- upload ---------------- */

function UploadHero({ onDone }: { onDone: (v: Video) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [stage, setStage] = useState(-1);
  const [pct, setPct] = useState(0);
  const [name, setName] = useState("");

  async function handle(file: File) {
    setName(file.name);
    setStage(0);
    try {
      const v = await uploadVideo(file, file.name.replace(/\.[^.]+$/, ""), (p) => { setPct(p); if (p >= 100) setStage(1); });
      setStage(2);
      onDone(v);
    } catch (e: any) {
      toast(e.message, "err");
      setStage(-1);
    }
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; f && handle(f); }}
      onClick={() => stage < 0 && input.current?.click()}
      className={cx("group relative grid cursor-pointer place-items-center overflow-hidden rounded-3xl border border-dashed px-8 py-20 text-center transition-all",
        drag ? "border-coral bg-coral/5" : "border-line2 bg-panel/60 hover:border-mute")}
    >
      <input ref={input} type="file" accept="video/*,audio/*" hidden onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
      {stage < 0 ? (
        <>
          <div className="mb-6 grid size-16 place-items-center rounded-full bg-coral/15 text-coral transition-transform group-hover:scale-105"><Upload className="size-7" /></div>
          <div className="display text-[40px] leading-tight">Drop a long video.<br /><em className="text-coral">Get your best moments back.</em></div>
          <p className="mt-3 text-mute">mp4, mov, webm, mp3 or m4a. Podcasts, talks, build logs, up to about an hour.</p>
        </>
      ) : (
        <div className="w-full max-w-md">
          <div className="mb-6 truncate text-sm text-mute">{name}</div>
          <ol className="space-y-3 text-left">
            {STAGES.map((s, i) => (
              <li key={s} className={cx("flex items-center gap-3 text-[15px] transition-colors", i < stage ? "text-mint" : i === stage ? "text-text" : "text-dim")}>
                <span className={cx("grid size-6 place-items-center rounded-full border text-[11px]",
                  i < stage ? "border-mint/50 bg-mint/10" : i === stage ? "border-coral bg-coral/15 text-coral" : "border-line2")}>
                  {i < stage ? "✓" : i + 1}
                </span>
                {s}{i === 0 && stage === 0 ? ` · ${pct}%` : ""}
                {i === stage && <span className="pulse-dot ml-auto size-1.5 rounded-full bg-coral" />}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/* ---------------- player ---------------- */

function captionAt(segs: Segment[], t: number) {
  const s = segs.find((x) => t >= x.start && t < x.end);
  if (!s) return null;
  const words = s.text.split(/\s+/).filter(Boolean);
  const prog = (t - s.start) / Math.max(0.1, s.end - s.start);
  const wi = Math.min(words.length - 1, Math.floor(prog * words.length));
  const size = 5, ci = Math.floor(wi / size);
  return { words: words.slice(ci * size, ci * size + size), active: wi - ci * size };
}

function Player({ video, active, onEnd, vref, time, setTime, playing, setPlaying }: {
  video: Video; active: Clip | null; onEnd: () => void; vref: React.RefObject<HTMLVideoElement>;
  time: number; setTime: (t: number) => void; playing: boolean; setPlaying: (p: boolean) => void;
}) {
  const [vertical, setVertical] = useState(true);
  const cap = useMemo(() => captionAt(video.segments || [], time), [video.segments, time]);
  const clipPct = active ? Math.max(0, Math.min(1, (time - active.start) / (active.end - active.start))) : 0;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[12px] font-semibold uppercase tracking-[.16em] text-mute">{active ? `Clip #${active.rank} · ${fmtTime(active.start)}–${fmtTime(active.end)}` : "Preview"}</div>
        <div className="flex rounded-lg border border-line bg-panel2 p-0.5 text-[12px]">
          {[["9:16", true], ["16:9", false]].map(([l, v]) => (
            <button key={String(l)} onClick={() => setVertical(v as boolean)} className={cx("rounded-md px-2.5 py-1", vertical === v ? "bg-text text-ink" : "text-mute")}>{l as string}</button>
          ))}
        </div>
      </div>
      <div className={cx("relative mx-auto overflow-hidden rounded-2xl border border-line bg-black shadow-2xl", vertical ? "aspect-[9/16] max-h-[620px]" : "aspect-video w-full")}>
        <video
          ref={vref} src={video.url} preload="metadata" playsInline
          className={cx("absolute inset-0 size-full", vertical ? "object-cover" : "object-contain", !video.has_video && "opacity-0")}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            setTime(t);
            if (active && t >= active.end) { e.currentTarget.pause(); onEnd(); }
          }}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        />
        {!video.has_video && (
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-gradient-to-b from-[#1d1410] to-black">
            {Array.from({ length: 24 }).map((_, i) => (
              <span key={i} className="w-1.5 rounded-full bg-coral/70 transition-all" style={{ height: playing ? `${20 + ((i * 37 + Math.floor(time * 8)) % 60)}px` : "8px" }} />
            ))}
          </div>
        )}
        {cap && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[16%] px-5 text-center">
            <div className="inline-block text-[26px] font-extrabold leading-tight tracking-tight text-white [text-shadow:0_2px_0_#000,0_0_18px_rgba(0,0,0,.85)]">
              {cap.words.map((w, i) => (
                <span key={i}>
                  <span className={cx("caption-word", i === cap.active && "scale-110 text-gold")}>{w}</span>{i < cap.words.length - 1 ? " " : ""}
                </span>
              ))}
            </div>
          </div>
        )}
        {active && (
          <div className="absolute inset-x-0 top-0 h-1 bg-white/10"><div className="h-full bg-coral transition-[width]" style={{ width: `${clipPct * 100}%` }} /></div>
        )}
        <button
          onClick={() => { const v = vref.current; if (!v) return; v.paused ? v.play() : v.pause(); }}
          className="absolute bottom-3 left-3 grid size-10 place-items-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80">
          {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </button>
      </div>
    </div>
  );
}

function Timeline({ duration, run, time, active, onPick }: { duration: number; run: Run | null; time: number; active: Clip | null; onPick: (c: Clip) => void }) {
  if (!run || !duration) return null;
  return (
    <div className="mt-5">
      <div className="mb-2 flex justify-between text-[11px] text-dim"><span>0:00</span><span>where the clips sit in the full video</span><span>{fmtTime(duration)}</span></div>
      <div className="relative h-9 rounded-lg border border-line bg-panel2">
        {run.rejected.map((c) => (
          <div key={c.id} title={`Passed on: ${c.why}`} className="hatch absolute inset-y-1.5 rounded bg-white/5"
            style={{ left: `${(c.start / duration) * 100}%`, width: `${Math.max(0.6, ((c.end - c.start) / duration) * 100)}%` }} />
        ))}
        {run.picked.map((c) => (
          <button key={c.id} onClick={() => onPick(c)} title={c.title}
            className={cx("absolute inset-y-1 grid place-items-center rounded text-[10px] font-bold text-ink transition-all hover:brightness-110",
              active?.id === c.id ? "bg-gold" : "bg-coral")}
            style={{ left: `${(c.start / duration) * 100}%`, width: `${Math.max(1.2, ((c.end - c.start) / duration) * 100)}%` }}>
            {c.rank}
          </button>
        ))}
        <div className="pointer-events-none absolute inset-y-0 w-px bg-white" style={{ left: `${(time / duration) * 100}%` }} />
      </div>
    </div>
  );
}

/* ---------------- clips ---------------- */

function ClipCard({ clip, active, playing, onPlay, onWrite, badge }: { clip: Clip; active: boolean; playing: boolean; onPlay: () => void; onWrite: () => void; badge?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx("rise rounded-2xl border bg-panel p-5 transition-all", active ? "border-coral/60 shadow-[0_0_0_4px_rgba(255,91,56,.08)]" : "border-line hover:border-line2")}
      style={{ animationDelay: `${clip.rank * 70}ms` }}>
      <div className="flex gap-4">
        <div className="display w-8 shrink-0 text-[40px] leading-none text-dim">{clip.rank}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[16px] font-semibold leading-snug">{clip.title}</h3>
                {badge}
              </div>
              <div className="mono mt-1 text-[12px] text-mute">{fmtTime(clip.start)}–{fmtTime(clip.end)} · {Math.round(clip.end - clip.start)}s</div>
            </div>
            <ScoreRing score={clip.score} />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">{clip.reasons.map((r) => <Chip key={r}>{r}</Chip>)}</div>
          {clip.editor_note && <p className="display mt-3 text-[17px] italic leading-snug text-text/80">“{clip.editor_note}”</p>}
          {open && (
            <div className="mt-4 grid grid-cols-5 gap-3">
              {Object.entries(clip.scores).map(([k, v]) => (
                <div key={k}>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">{k}</div>
                  <div className="h-1.5 rounded-full bg-line"><div className={cx("h-full rounded-full", k === "fit" ? "bg-coral" : "bg-gold")} style={{ width: `${v}%` }} /></div>
                  <div className="mt-1 text-[11px] text-mute">{Math.round(v)}</div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" variant={active && playing ? "primary" : "soft"} onClick={onPlay}>
              {active && playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} {active && playing ? "Playing" : "Play"}
            </Button>
            <Button size="sm" onClick={onWrite}><PenLine className="size-3.5" /> Write posts</Button>
            <a href={`/api/clips/${clip.id}/export`} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] text-mute hover:bg-panel2 hover:text-text"><Download className="size-3.5" /> Export</a>
            <button onClick={() => setOpen(!open)} className="ml-auto inline-flex items-center gap-1 text-[12px] text-dim hover:text-mute">
              scores <ChevronDown className={cx("size-3.5 transition-transform", open && "rotate-180")} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Rejected({ clips, onPlay }: { clips: Clip[]; onPlay: (c: Clip) => void }) {
  const [open, setOpen] = useState(false);
  if (!clips.length) return null;
  return (
    <div className="rounded-2xl border border-line bg-panel/50">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-5 py-3.5 text-sm text-mute hover:text-text">
        <span className="flex items-center gap-2"><X className="size-4 text-rose" /> {clips.length} moments Encore passed on, and why</span>
        <ChevronDown className={cx("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-5 py-4">
          {clips.map((c) => (
            <button key={c.id} onClick={() => onPlay(c)} className="flex w-full items-start gap-3 rounded-lg p-2 text-left hover:bg-panel2">
              <span className="mono mt-0.5 text-[12px] text-dim">{fmtTime(c.start)}</span>
              <span className="flex-1">
                <span className="block text-[14px] text-text/80">{c.title}</span>
                <span className="block text-[13px] text-rose/90">{c.why}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MoveBadge({ row }: { row?: Diff["rows"][number] }) {
  if (!row) return null;
  if (row.status === "new") return <Chip tone="gold"><Sparkles className="size-3" /> new pick</Chip>;
  if (row.status === "up") return <Chip tone="mint"><ArrowUp className="size-3" /> up {row.move}</Chip>;
  if (row.status === "down") return <Chip tone="rose"><ArrowDown className="size-3" /> down {Math.abs(row.move || 0)}</Chip>;
  return <Chip>same rank</Chip>;
}

/* ---------------- page ---------------- */

export default function Studio({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const vref = useRef<HTMLVideoElement>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [video, setVideo] = useState<Video | null>(null);
  const [runs, setRuns] = useState<{ blank: Run | null; learned: Run | null }>({ blank: null, learned: null });
  const [mode, setMode] = useState<Mode>("blank");
  const [diff, setDiff] = useState<Diff | null>(null);
  const [active, setActive] = useState<Clip | null>(null);
  const [writing, setWriting] = useState<Clip | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const openVideo = useCallback(async (id: number) => {
    const [v, r] = await Promise.all([api.video(id), api.runs(id)]);
    setVideo(v); setRuns(r); setActive(null); setWriting(null); setDiff(null);
    setMode(r.learned ? "learned" : "blank");
  }, []);

  useEffect(() => {
    api.videos().then((vs) => { setVideos(vs); setLoaded(true); if (vs[0]) openVideo(vs[0].id); });
  }, [openVideo]);

  const run = mode === "learned" ? runs.learned : runs.blank;

  async function findClips(brain: "blank" | "learned", v: Video | null = video) {
    if (!v) return;
    setBusy(true);
    try {
      const r = await api.findClips(v.id, brain);
      setRuns((old) => ({ ...old, [brain]: r }));
      setMode(brain);
      setActive(null);
      toast(brain === "learned" ? "Learned brain ranked the clips using your Voice DNA and results." : `Picked ${r.picked.length} clips.`);
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  async function showCompare() {
    setMode("compare");
    if (!runs.blank || !runs.learned) return;
    try { setDiff(await api.compare(video!.id)); } catch (e: any) { toast(e.message, "err"); }
  }

  function play(c: Clip) {
    const v = vref.current;
    if (!v) return;
    if (active?.id === c.id && playing) { v.pause(); return; }
    setActive(c);
    v.currentTime = c.start;
    v.play().catch(() => {});
  }

  async function onUploaded(v: Video) {
    setVideos((vs) => [v, ...vs]);
    setVideo(v); setRuns({ blank: null, learned: null }); setAdding(false);
    onChange();
    await findClips("blank", v);
  }

  if (!loaded) return null;

  if (!video || adding) {
    return (
      <div>
        <PageHeader eyebrow="Studio" title={<>Record once. <em className="text-coral">Post all week.</em></>}
          sub="Encore finds the moments worth posting, tells you why, writes the posts in your voice, and gets smarter from your edits and your real numbers."
          right={video && <Button variant="ghost" onClick={() => setAdding(false)}><X className="size-4" /> Cancel</Button>} />
        <UploadHero onDone={onUploaded} />
      </div>
    );
  }

  const byClip = Object.fromEntries((diff?.rows || []).map((r) => [r.clip_id, r]));

  return (
    <div>
      <PageHeader eyebrow="Studio" title={video.title}
        sub={<>{fmtTime(video.duration_s)} · {video.segment_count} transcript segments{video.mock && " · demo transcript"}</>}
        right={
          <div className="flex items-center gap-2">
            {videos.length > 1 && (
              <select value={video.id} onChange={(e) => openVideo(Number(e.target.value))}
                className="h-10 rounded-lg border border-line bg-panel2 px-3 text-sm outline-none [color-scheme:dark]">
                {videos.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
              </select>
            )}
            <Button onClick={() => setAdding(true)}><Plus className="size-4" /> New video</Button>
          </div>
        } />

      <div className="grid gap-8 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <div className="lg:sticky lg:top-8 lg:self-start">
          <Player video={video} active={active} onEnd={() => {}} vref={vref} time={time} setTime={setTime} playing={playing} setPlaying={setPlaying} />
          <Timeline duration={video.duration_s} run={mode === "compare" ? runs.learned || runs.blank : run} time={time} active={active} onPick={play} />
        </div>

        <div className="min-w-0 space-y-4">
          <Card className="flex flex-wrap items-center gap-3 p-2">
            {([["blank", "Blank brain"], ["learned", "Learned brain"], ["compare", "Compare"]] as [Mode, string][]).map(([m, l]) => (
              <button key={m} onClick={() => (m === "compare" ? showCompare() : setMode(m))}
                className={cx("flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition-colors",
                  mode === m ? "bg-text text-ink" : "text-mute hover:bg-panel2 hover:text-text")}>
                {m === "learned" && <Brain className="size-4" />}{l}
              </button>
            ))}
            <div className="ml-auto pr-1">
              {mode !== "compare" && (
                <Button size="sm" variant={run ? "soft" : "primary"} loading={busy} onClick={() => findClips(mode as "blank" | "learned")}>
                  <Film className="size-3.5" /> {run ? "Re-run" : "Find clips"}
                </Button>
              )}
            </div>
          </Card>

          {mode === "learned" && run && (
            <div className="rise flex items-start gap-3 rounded-2xl border border-coral/30 bg-coral/[.06] px-5 py-4">
              <Brain className="mt-0.5 size-5 shrink-0 text-coral" />
              <div className="text-[14px]">
                <div className="font-medium">Using {run.rule_count} Voice DNA rule{run.rule_count === 1 ? "" : "s"} and {run.insight_count} performance insight{run.insight_count === 1 ? "" : "s"}.</div>
                {run.learning_note && <div className="mt-1 text-mute">{run.learning_note}</div>}
              </div>
            </div>
          )}

          {mode === "compare" ? (
            !runs.blank || !runs.learned ? (
              <Card className="p-8 text-center text-sm text-mute">Run both the blank brain and the learned brain on this video to compare them.</Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {(["blank", "learned"] as const).map((b) => (
                  <div key={b}>
                    <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[.16em] text-mute">
                      {b === "learned" ? <Brain className="size-4 text-coral" /> : <span className="size-4 rounded-full border border-dim" />}
                      {b === "blank" ? "Blank brain · knows nothing about you" : "Learned brain · your edits + your numbers"}
                    </div>
                    <div className="space-y-2">
                      {runs[b]!.picked.map((c) => (
                        <button key={c.id} onClick={() => play(c)}
                          className={cx("rise flex w-full items-center gap-3 rounded-xl border bg-panel p-3 text-left hover:border-line2", b === "learned" && byClip[c.id]?.status !== "same" ? "border-coral/30" : "border-line")}>
                          <span className="display w-6 text-2xl text-dim">{c.rank}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium">{c.title}</span>
                            <span className="mono text-[11px] text-mute">{fmtTime(c.start)} · score {Math.round(c.score)}</span>
                          </span>
                          {b === "learned" && <MoveBadge row={byClip[c.id]} />}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {diff?.learning_note && <div className="md:col-span-2 rounded-xl border border-line bg-panel/60 p-4 text-sm text-mute"><span className="text-text">Why it changed: </span>{diff.learning_note}</div>}
                {!!diff?.dropped.length && <div className="md:col-span-2 text-[13px] text-dim">Dropped by the learned brain: {diff.dropped.map((d) => d.title).join(" · ")}</div>}
              </div>
            )
          ) : !run ? (
            <Card className="grid place-items-center px-6 py-14 text-center">
              <Brain className="mb-3 size-8 text-dim" />
              <div className="display text-2xl">{mode === "learned" ? "Run the learned brain" : "No clips yet"}</div>
              <p className="mt-1 max-w-sm text-sm text-mute">{mode === "learned" ? "It ranks the same video using everything Encore has learned from your edits and your post numbers." : "Find the moments worth posting."}</p>
              <Button className="mt-5" variant="primary" loading={busy} onClick={() => findClips(mode as "blank" | "learned")}><Film className="size-4" /> Find clips</Button>
            </Card>
          ) : (
            <>
              {run.picked.map((c) => (
                <ClipCard key={c.id} clip={c} active={active?.id === c.id} playing={playing} onPlay={() => play(c)}
                  onWrite={() => { setWriting(c); setTimeout(() => document.getElementById("copy-panel")?.scrollIntoView({ behavior: "smooth" }), 50); }} />
              ))}
              <Rejected clips={run.rejected} onPlay={play} />
            </>
          )}
        </div>
      </div>

      <div id="copy-panel">{writing && <CopyPanel clip={writing} onLearned={onChange} />}</div>
    </div>
  );
}

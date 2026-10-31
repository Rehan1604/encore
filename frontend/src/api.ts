export type Segment = { idx: number; start: number; end: number; text: string };
export type Video = {
  id: number; title: string; url: string; has_video: boolean; duration_s: number;
  language: string; mock: boolean; created_at: string; segment_count: number; segments?: Segment[];
};
export type Clip = {
  id: number; run_id: number; status: "picked" | "rejected"; rank: number;
  start_seg: number; end_seg: number; start: number; end: number; title: string;
  score: number; scores: Record<string, number>; reasons: string[];
  editor_note: string; hook_line: string; why: string;
};
export type Run = {
  id: number; video_id: number; brain: "blank" | "learned"; learning_note: string;
  rule_count: number; insight_count: number; mock: boolean; created_at: string;
  picked: Clip[]; rejected: Clip[];
};
export type Post = {
  id: number; clip_id: number | null; batch: number; platform: string;
  draft_text: string; edited_text: string; text: string; hook_style: string;
  applied_rules: { rule_id: number; where: string }[];
  scheduled_for: string | null; published_url: string; published_at: string | null;
  impressions: number; reactions: number; comments: number; reposts: number;
  is_external: boolean; engagement_rate: number; created_at: string;
};
export type Rule = {
  id: number; rule: string; before: string; after: string; source_post_id: number | null;
  origin: string; confidence: number; reinforced: number; active: boolean; created_at: string;
};
export type Insight = { id: number; finding: string; evidence: string; effect: string; strength: string; active: boolean; created_at: string };
export type DiffRow = { clip_id: number; title: string; new_rank: number; old_rank: number | null; move: number | null; status: "up" | "down" | "same" | "new"; reason: string };
export type Diff = { from_run: number; from_brain: string; to_run: number; to_brain: string; learning_note: string; rows: DiffRow[]; dropped: { clip_id: number; title: string; old_rank: number }[] };
export type Status = { llm_mock: boolean; whisper_mock: boolean; llm_model: string; whisper_model: string; creator: string; counts: { videos: number; rules: number; insights: number } };
export type TraceRow = { id: number; step: string; model: string; input_summary: string; output_json: string; ms: number; mock: boolean; ok: boolean; created_at: string };

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const r = await fetch(url, init);
  if (!r.ok) {
    let msg = `${r.status}`;
    try { msg = (await r.json()).detail || msg; } catch { /* not json */ }
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return r.json();
}

export const api = {
  status: () => req<Status>("GET", "/api/status"),
  videos: () => req<Video[]>("GET", "/api/videos"),
  video: (id: number) => req<Video>("GET", `/api/videos/${id}`),
  findClips: (id: number, brain: string) => req<Run>("POST", `/api/videos/${id}/clips?brain=${brain}`),
  runs: (id: number) => req<{ blank: Run | null; learned: Run | null }>("GET", `/api/videos/${id}/runs`),
  compare: (id: number) => req<Diff>("GET", `/api/videos/${id}/compare`),
  writeCopy: (clipId: number) => req<Post[]>("POST", `/api/clips/${clipId}/copy`),
  clipPosts: (clipId: number) => req<Post[]>("GET", `/api/clips/${clipId}/posts`),
  posts: () => req<Post[]>("GET", "/api/posts"),
  instruct: (id: number, instruction: string) => req<{ post: Post; new_rules: Rule[] }>("POST", `/api/posts/${id}/instruct`, { instruction }),
  editPost: (id: number, edited_text: string) => req<{ post: Post; new_rules: Rule[]; reinforced: number[] }>("PUT", `/api/posts/${id}`, { edited_text }),
  publish: (id: number, url: string) => req<Post>("POST", `/api/posts/${id}/publish`, { url, published_at: localIso(new Date()) }),
  schedule: (id: number, when: string | null) => req<Post>("PUT", `/api/posts/${id}/schedule`, { scheduled_for: when }),
  external: (b: { text: string; url: string; impressions: number; reactions: number; comments: number; reposts: number }) => req<Post>("POST", "/api/posts/external", { ...b, published_at: localIso(new Date()) }),
  rules: () => req<Rule[]>("GET", "/api/voice-rules"),
  patchRule: (id: number, b: Partial<Pick<Rule, "active" | "rule">>) => req<Rule>("PATCH", `/api/voice-rules/${id}`, b),
  describe: (text: string) => req<Rule[]>("POST", "/api/voice/describe", { text }),
  analyticsXlsx: (f: File) => { const fd = new FormData(); fd.append("file", f); return req<{ matched: any[]; unmatched: any[] }>("POST", "/api/analytics/xlsx", fd); },
  analyticsManual: (entries: { post_id: number; impressions: number; reactions: number; comments: number; reposts: number; url?: string }[]) => req<Post[]>("POST", "/api/analytics/manual", { entries }),
  learn: () => req<{ insights: Insight[]; diff: Diff | null; video_id?: number }>("POST", "/api/analytics/learn"),
  insights: () => req<Insight[]>("GET", "/api/insights"),
  calendar: () => req<{ suggested: { hours: number[]; source: string }; posts: Post[] }>("GET", "/api/calendar"),
  trace: () => req<TraceRow[]>("GET", "/api/trace"),
  voiceLog: () => req<{ entries: { id: number; who: string; text: string; created_at: string }[]; count: number; words: number; voice_rules: number; screenshot: string | null }>("GET", "/api/voice-log"),
  addLog: (text: string) => req<{ id: number }>("POST", "/api/voice-log", { text }),
  uploadShot: (f: File) => { const fd = new FormData(); fd.append("file", f); return req<{ url: string }>("POST", "/api/voice-log/screenshot", fd); },
};

export function uploadVideo(file: File, title: string, onProgress: (pct: number) => void): Promise<Video> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", title);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/videos");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.upload.onload = () => onProgress(100);
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        xhr.status < 300 ? resolve(body) : reject(new Error(body.detail || xhr.statusText));
      } catch { reject(new Error(xhr.statusText || "Upload failed")); }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(fd);
  });
}

export function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export const PLATFORM_LABEL: Record<string, string> = {
  linkedin: "LinkedIn", x_thread: "X thread", reels_caption: "Reels caption", shorts_title: "Shorts title",
};

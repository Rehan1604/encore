import { useEffect, useMemo, useState } from "react";
import { Check, Copy, PenLine, RefreshCw, Send, Sparkles, CalendarPlus, Mic } from "lucide-react";
import { api, Clip, Post, Rule, PLATFORM_LABEL, localIso } from "../api";
import { Button, Card, Chip, cx, useToast } from "../ui";

function Highlighted({ text, applied, rules }: { text: string; applied: Post["applied_rules"]; rules: Record<number, Rule> }) {
  const parts = useMemo(() => {
    const marks: { start: number; end: number; rule: string }[] = [];
    const lower = text.toLowerCase();
    for (const a of applied || []) {
      const w = (a.where || "").trim();
      if (w.length < 6) continue;
      const i = lower.indexOf(w.toLowerCase());
      if (i >= 0 && !marks.some((m) => i < m.end && i + w.length > m.start)) {
        marks.push({ start: i, end: i + w.length, rule: rules[a.rule_id]?.rule || "voice rule" });
      }
    }
    marks.sort((a, b) => a.start - b.start);
    const out: { t: string; rule?: string }[] = [];
    let pos = 0;
    for (const m of marks) {
      if (m.start > pos) out.push({ t: text.slice(pos, m.start) });
      out.push({ t: text.slice(m.start, m.end), rule: m.rule });
      pos = m.end;
    }
    out.push({ t: text.slice(pos) });
    return out;
  }, [text, applied, rules]);
  return (
    <div className="whitespace-pre-wrap text-[15px] leading-relaxed">
      {parts.map((p, i) => p.rule ? <mark key={i} className="rule" title={`Voice DNA: ${p.rule}`}>{p.t}</mark> : <span key={i}>{p.t}</span>)}
    </div>
  );
}

export default function CopyPanel({ clip, onLearned }: { clip: Clip; onLearned: () => void }) {
  const toast = useToast();
  const [posts, setPosts] = useState<Post[]>([]);
  const [tab, setTab] = useState("linkedin");
  const [rules, setRules] = useState<Record<number, Rule>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"" | "write" | "save" | "publish" | "schedule" | "voice">("");
  const [learned, setLearned] = useState<Rule[]>([]);
  const [url, setUrl] = useState("");
  const [when, setWhen] = useState("");
  const [copied, setCopied] = useState(false);
  const [said, setSaid] = useState("");
  const [lastSaid, setLastSaid] = useState("");

  const loadRules = () => api.rules().then((rs) => setRules(Object.fromEntries(rs.map((r) => [r.id, r]))));
  useEffect(() => {
    setPosts([]); setLearned([]); setEditing(false);
    api.clipPosts(clip.id).then(setPosts).catch(() => {});
    loadRules();
  }, [clip.id]);

  const post = posts.find((p) => p.platform === tab);
  useEffect(() => { setDraft(post?.text || ""); setUrl(post?.published_url || ""); setEditing(false); }, [post?.id]);

  async function write() {
    setBusy("write");
    try {
      const ps = await api.writeCopy(clip.id);
      setPosts(ps);
      await loadRules();
      const n = ps.reduce((a, p) => a + (p.applied_rules?.length || 0), 0);
      toast(n ? `Drafted 4 posts. ${n} Voice DNA rule${n > 1 ? "s" : ""} applied, highlighted in coral.` : "Drafted 4 posts in your voice.");
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(""); }
  }

  async function save() {
    if (!post) return;
    setBusy("save");
    try {
      const r = await api.editPost(post.id, draft);
      setPosts((ps) => ps.map((p) => (p.id === post.id ? r.post : p)));
      setEditing(false);
      if (r.new_rules.length) {
        setLearned(r.new_rules);
        toast(`Encore learned ${r.new_rules.length} new rule${r.new_rules.length > 1 ? "s" : ""} from your edit.`, "learn");
        await loadRules();
        onLearned();
      } else if (r.reinforced.length) toast("Edit saved. It reinforced a rule Encore already knew.", "learn");
      else toast("Edit saved.");
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(""); }
  }

  async function applySpoken() {
    if (!post || said.trim().split(/\s+/).length < 2) return;
    setBusy("voice");
    try {
      const r = await api.instruct(post.id, said.trim());
      setPosts((ps) => ps.map((p) => (p.id === post.id ? r.post : p)));
      setLastSaid(said.trim());
      setSaid("");
      setLearned(r.new_rules);
      if (r.new_rules.length) {
        toast(`Rewritten. Encore turned what you said into ${r.new_rules.length} Voice DNA rule${r.new_rules.length > 1 ? "s" : ""}.`, "learn");
        await loadRules();
        onLearned();
      } else toast("Rewritten the way you said.");
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(""); }
  }

  async function publish() {
    if (!post) return;
    setBusy("publish");
    try {
      const p = await api.publish(post.id, url);
      setPosts((ps) => ps.map((x) => (x.id === p.id ? p : x)));
      toast("Marked as published. Add its numbers in Performance later.");
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(""); }
  }

  async function schedule() {
    if (!post || !when) return;
    setBusy("schedule");
    try {
      const p = await api.schedule(post.id, localIso(new Date(when)));
      setPosts((ps) => ps.map((x) => (x.id === p.id ? p : x)));
      toast("Added to your calendar.");
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(""); }
  }

  function copy() {
    navigator.clipboard.writeText(post?.text || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card className="rise mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[.18em] text-coral">Posts from clip #{clip.rank}</div>
          <div className="display mt-0.5 text-2xl">{clip.title}</div>
        </div>
        <Button variant={posts.length ? "soft" : "primary"} onClick={write} loading={busy === "write"}>
          {posts.length ? <><RefreshCw className="size-4" /> Rewrite in my voice</> : <><Sparkles className="size-4" /> Write posts</>}
        </Button>
      </div>

      {!posts.length ? (
        <div className="px-6 py-10 text-center text-sm text-mute">
          {busy === "write" ? "Writing a LinkedIn post, an X thread, a Reels caption and a Shorts title…" : "Encore writes four posts from this clip, following every Voice DNA rule it has learned."}
        </div>
      ) : (
        <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
          <div className="border-line px-6 py-5 lg:border-r">
            <div className="mb-4 flex flex-wrap gap-1.5">
              {posts.map((p) => (
                <button key={p.id} onClick={() => setTab(p.platform)}
                  className={cx("rounded-full px-3.5 py-1.5 text-[13px] transition-colors",
                    tab === p.platform ? "bg-text text-ink" : "bg-panel2 text-mute hover:text-text")}>
                  {PLATFORM_LABEL[p.platform] || p.platform}
                </button>
              ))}
            </div>
            {post && (
              editing ? (
                <div>
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
                    className="min-h-[260px] w-full resize-y rounded-xl border border-coral/40 bg-ink/60 p-4 text-[15px] leading-relaxed outline-none focus:border-coral" />
                  <div className="mt-2 flex items-center gap-2 text-[12px] text-mute">
                    <Mic className="size-3.5 text-coral" /> Hold your Wispr Flow key and say the edit. Encore learns a rule from what you change.
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button variant="primary" onClick={save} loading={busy === "save"}><Check className="size-4" /> Save and teach Encore</Button>
                    <Button variant="ghost" onClick={() => { setEditing(false); setDraft(post.text); }}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-4 rounded-xl border border-coral/35 bg-coral/[.05] p-3">
                    <div className="mb-2 flex items-center gap-2 px-1 text-[12px] font-semibold text-coral">
                      <Mic className="size-3.5" /> Tell Encore what to change
                      <span className="font-normal text-mute">· hold your Wispr Flow key and speak</span>
                    </div>
                    <div className="flex gap-2">
                      <input value={said} onChange={(e) => setSaid(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applySpoken()}
                        placeholder="“Cut the hashtags, open with the number, and never end on a question.”"
                        className="h-11 flex-1 rounded-lg border border-line bg-ink/70 px-3 text-[14px] outline-none placeholder:text-dim focus:border-coral/60" />
                      <Button variant="primary" onClick={applySpoken} loading={busy === "voice"} disabled={said.trim().split(/\s+/).length < 2}>Apply</Button>
                    </div>
                    {lastSaid && <div className="mt-2 px-1 text-[12px] text-mute">Last instruction: <span className="text-text/80">“{lastSaid}”</span></div>}
                  </div>
                  <div className="rounded-xl border border-line bg-ink/40 p-5">
                    <Highlighted text={post.text} applied={post.edited_text ? [] : post.applied_rules} rules={rules} />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button onClick={() => setEditing(true)}><PenLine className="size-4" /> Edit</Button>
                    <Button variant="ghost" onClick={copy}>{copied ? <Check className="size-4 text-mint" /> : <Copy className="size-4" />} Copy</Button>
                    {post.edited_text && <Chip tone="mint">edited by you</Chip>}
                    {!post.edited_text && post.applied_rules?.length > 0 && <Chip tone="coral">{post.applied_rules.length} voice rule{post.applied_rules.length > 1 ? "s" : ""} applied</Chip>}
                    {post.hook_style && <Chip>hook: {post.hook_style}</Chip>}
                  </div>
                </div>
              )
            )}
            {learned.length > 0 && (
              <div className="mt-6">
                <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[.16em] text-coral">
                  <Sparkles className="size-3.5" /> Encore just learned
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {learned.map((r, i) => (
                    <div key={r.id} className="rise glow rounded-xl border border-coral/40 bg-coral/[.06] p-4" style={{ animationDelay: `${i * 120}ms` }}>
                      <div className="font-medium">{r.rule}</div>
                      {(r.before || r.after) && (
                        <div className="mt-2 text-[12px] text-mute">
                          {r.before && <span className="text-rose line-through decoration-rose/60">{r.before.slice(0, 60)}</span>}
                          {r.before && r.after && <span className="mx-1.5">→</span>}
                          {r.after && <span className="text-mint">{r.after.slice(0, 60)}</span>}
                        </div>
                      )}
                      <div className="mt-2 text-[11px] text-dim">{r.origin === "voice" ? "learned from what you just said" : "learned from your edit just now"}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-5 px-6 py-5">
            <div>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-[.14em] text-mute">Published it?</div>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste the LinkedIn post URL"
                className="h-10 w-full rounded-lg border border-line bg-ink/60 px-3 text-sm outline-none focus:border-line2" />
              <Button className="mt-2 w-full" onClick={publish} loading={busy === "publish"}><Send className="size-4" /> Mark as published</Button>
              {post?.published_at && <div className="mt-2 text-[12px] text-mint">Published · numbers go in Performance</div>}
            </div>
            <div>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-[.14em] text-mute">Schedule</div>
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
                className="h-10 w-full rounded-lg border border-line bg-ink/60 px-3 text-sm outline-none [color-scheme:dark] focus:border-line2" />
              <Button className="mt-2 w-full" onClick={schedule} disabled={!when} loading={busy === "schedule"}><CalendarPlus className="size-4" /> Add to calendar</Button>
              {post?.scheduled_for && <div className="mt-2 text-[12px] text-mute">Scheduled for {new Date(post.scheduled_for).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</div>}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

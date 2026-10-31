import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BarChart3, Brain, FileSpreadsheet, Lightbulb, Plus, Sparkles } from "lucide-react";
import { api, Diff, Insight, Post, PLATFORM_LABEL } from "../api";
import { Button, Card, Chip, cx, PageHeader, useToast } from "../ui";

type Nums = { impressions: number; reactions: number; comments: number; reposts: number };

function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <input type="number" min={0} value={value || ""} placeholder="0" onChange={(e) => onChange(Number(e.target.value) || 0)}
    className="h-9 w-full rounded-lg border border-line bg-ink/60 px-2.5 text-right text-sm tabular-nums outline-none focus:border-line2" />;
}

export default function Performance({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [nums, setNums] = useState<Record<number, Nums>>({});
  const [insights, setInsights] = useState<Insight[]>([]);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [unmatched, setUnmatched] = useState<any[]>([]);
  const [busy, setBusy] = useState<"" | "save" | "learn" | "xlsx" | "ext">("");
  const [ext, setExt] = useState({ text: "", url: "", impressions: 0, reactions: 0, comments: 0, reposts: 0 });
  const [showExt, setShowExt] = useState(false);

  async function load() {
    const ps = (await api.posts()).filter((p) => p.published_at || p.is_external || p.impressions > 0);
    setPosts(ps);
    setNums(Object.fromEntries(ps.map((p) => [p.id, { impressions: p.impressions, reactions: p.reactions, comments: p.comments, reposts: p.reposts }])));
    setInsights((await api.insights()).filter((i) => i.active));
  }
  useEffect(() => { load(); }, []);

  async function saveNums() {
    setBusy("save");
    try {
      await api.analyticsManual(Object.entries(nums).map(([id, n]) => ({ post_id: Number(id), ...n })));
      await load();
      toast("Numbers saved.");
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(""); }
  }

  async function uploadXlsx(f: File) {
    setBusy("xlsx");
    try {
      const r = await api.analyticsXlsx(f);
      setUnmatched(r.unmatched);
      await load();
      toast(`Matched ${r.matched.length} post${r.matched.length === 1 ? "" : "s"} by URL.${r.unmatched.length ? ` ${r.unmatched.length} need a match below.` : ""}`);
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(""); }
  }

  async function assign(row: any, postId: number) {
    await api.analyticsManual([{ post_id: postId, impressions: row.impressions || 0, reactions: row.reactions || 0, comments: row.comments || 0, reposts: row.reposts || 0, url: row.url || undefined }]);
    setUnmatched((u) => u.filter((x) => x !== row));
    await load();
    toast("Matched.");
  }

  async function addExternal() {
    setBusy("ext");
    try {
      await api.external(ext);
      setExt({ text: "", url: "", impressions: 0, reactions: 0, comments: 0, reposts: 0 });
      setShowExt(false);
      await load();
      toast("Post added.");
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(""); }
  }

  async function learn() {
    setBusy("learn");
    try {
      await api.analyticsManual(Object.entries(nums).map(([id, n]) => ({ post_id: Number(id), ...n })));
      const r = await api.learn();
      setInsights(r.insights);
      setDiff(r.diff);
      onChange();
      toast("Encore learned from your real numbers and re-ranked your clips.", "learn");
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(""); }
  }

  const maxImp = Math.max(1, ...posts.map((p) => nums[p.id]?.impressions || 0));
  const allPosts = posts;

  return (
    <div>
      <PageHeader eyebrow="Performance feedback loop" title={<>What <em className="text-coral">actually</em> worked</>}
        sub="Bring in the real numbers from your posts. Encore finds what drove them and changes what it picks and writes next."
        right={<Button variant="primary" onClick={learn} loading={busy === "learn"} disabled={!posts.length}><Brain className="size-4" /> Learn from results</Button>} />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="text-[13px] font-semibold">Your published posts</div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowExt(!showExt)}><Plus className="size-3.5" /> Post made outside Encore</Button>
              <Button size="sm" onClick={saveNums} loading={busy === "save"}>Save numbers</Button>
            </div>
          </div>
          {showExt && (
            <div className="rise space-y-3 border-b border-line bg-ink/30 px-5 py-4">
              <textarea value={ext.text} onChange={(e) => setExt({ ...ext, text: e.target.value })} placeholder="Paste the post text"
                className="min-h-[80px] w-full rounded-lg border border-line bg-ink/60 p-3 text-sm outline-none focus:border-line2" />
              <input value={ext.url} onChange={(e) => setExt({ ...ext, url: e.target.value })} placeholder="LinkedIn post URL"
                className="h-9 w-full rounded-lg border border-line bg-ink/60 px-3 text-sm outline-none focus:border-line2" />
              <div className="grid grid-cols-4 gap-2 text-[11px] text-dim">
                {(["impressions", "reactions", "comments", "reposts"] as const).map((k) => (
                  <label key={k}>{k}<NumInput value={ext[k]} onChange={(v) => setExt({ ...ext, [k]: v })} /></label>
                ))}
              </div>
              <Button size="sm" variant="primary" onClick={addExternal} loading={busy === "ext"} disabled={!ext.text.trim()}>Add post</Button>
            </div>
          )}
          {!allPosts.length ? (
            <div className="px-5 py-12 text-center text-sm text-mute">
              <BarChart3 className="mx-auto mb-3 size-7 text-dim" />
              Mark a post as published in the Studio, or add one you made outside Encore.
            </div>
          ) : (
            <div className="divide-y divide-line">
              <div className="grid grid-cols-[1fr_repeat(4,84px)] gap-2 px-5 py-2 text-[11px] uppercase tracking-wider text-dim">
                <span>post</span><span className="text-right">impressions</span><span className="text-right">reactions</span><span className="text-right">comments</span><span className="text-right">reposts</span>
              </div>
              {allPosts.map((p) => {
                const n = nums[p.id] || { impressions: 0, reactions: 0, comments: 0, reposts: 0 };
                const rate = n.impressions ? ((n.reactions + n.comments + n.reposts) / n.impressions) * 100 : 0;
                return (
                  <div key={p.id} className="grid grid-cols-[1fr_repeat(4,84px)] items-center gap-2 px-5 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="mono text-[11px] text-dim">#{p.id}</span>
                        <span className="truncate text-[14px]">{p.text.split("\n")[0]}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-line"><div className="h-full rounded-full bg-gold" style={{ width: `${(n.impressions / maxImp) * 100}%` }} /></div>
                        <span className="w-24 text-right text-[11px] text-mute">{rate ? `${rate.toFixed(1)}% engaged` : "no numbers"}</span>
                      </div>
                      <div className="mt-1 flex gap-1.5">
                        <Chip>{p.is_external ? "outside Encore" : PLATFORM_LABEL[p.platform]}</Chip>
                        {p.hook_style && <Chip>hook: {p.hook_style}</Chip>}
                      </div>
                    </div>
                    {(["impressions", "reactions", "comments", "reposts"] as const).map((k) => (
                      <NumInput key={k} value={n[k]} onChange={(v) => setNums({ ...nums, [p.id]: { ...n, [k]: v } })} />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card onClick={() => file.current?.click()} className="cursor-pointer p-5 transition-colors hover:border-line2">
            <input ref={file} type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && uploadXlsx(e.target.files[0])} />
            <FileSpreadsheet className="mb-3 size-6 text-mint" />
            <div className="font-semibold">Upload your LinkedIn export</div>
            <p className="mt-1 text-[13px] leading-relaxed text-mute">Profile → Analytics → Export (.xlsx). Encore matches posts by their URL.</p>
            {busy === "xlsx" && <div className="mt-2 text-[12px] text-coral">Reading…</div>}
          </Card>
          {unmatched.length > 0 && (
            <Card className="p-5">
              <div className="mb-3 text-[13px] font-semibold">Match these rows</div>
              <div className="space-y-3">
                {unmatched.map((row, i) => (
                  <div key={i} className="rounded-lg border border-line p-3 text-[12px]">
                    <div className="truncate text-mute">{row.url || "single-post export"}</div>
                    <div className="mt-1">{row.impressions} impressions · {row.reactions} reactions</div>
                    <select defaultValue="" onChange={(e) => e.target.value && assign(row, Number(e.target.value))}
                      className="mt-2 h-8 w-full rounded-md border border-line bg-panel2 px-2 [color-scheme:dark]">
                      <option value="">Which post is this?</option>
                      {allPosts.map((p) => <option key={p.id} value={p.id}>#{p.id} {p.text.slice(0, 40)}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <p className="px-1 text-[12px] leading-relaxed text-dim">Encore models what worked. It reports the evidence behind every finding and never invents a number.</p>
        </div>
      </div>

      {insights.length > 0 && (
        <div className="mt-10">
          <div className="mb-4 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[.16em] text-coral"><Lightbulb className="size-4" /> What Encore found</div>
          <div className="grid gap-4 md:grid-cols-3">
            {insights.map((i, k) => (
              <Card key={i.id} className="rise p-5" style={{ animationDelay: `${k * 100}ms` }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="display text-[22px] leading-tight">{i.finding}</div>
                  <Chip tone={i.strength === "solid" ? "mint" : "gold"}>{i.strength}</Chip>
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-mute">{i.evidence}</p>
                <div className="mt-4 border-t border-line pt-3 text-[13px]"><span className="text-coral">Next time: </span>{i.effect}</div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {diff && (
        <Card className="rise mt-6 p-6">
          <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[.16em] text-coral"><Sparkles className="size-4" /> What changed in your clips</div>
          {diff.learning_note && <p className="mb-4 text-[15px] text-mute">{diff.learning_note}</p>}
          <div className="space-y-2">
            {diff.rows.map((r) => (
              <div key={r.clip_id} className="flex items-center gap-4 rounded-xl border border-line bg-ink/40 px-4 py-3">
                <span className="display w-14 text-2xl text-dim">{r.old_rank ?? "–"}<span className="mx-1 text-base">→</span><span className="text-text">{r.new_rank}</span></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{r.title}</span>
                  <span className="block truncate text-[12px] text-mute">{r.reason}</span>
                </span>
                {r.status === "up" && <Chip tone="mint"><ArrowUp className="size-3" /> up {r.move}</Chip>}
                {r.status === "down" && <Chip tone="rose"><ArrowDown className="size-3" /> down {Math.abs(r.move || 0)}</Chip>}
                {r.status === "new" && <Chip tone="gold"><Sparkles className="size-3" /> new pick</Chip>}
                {r.status === "same" && <Chip>same</Chip>}
              </div>
            ))}
            {diff.dropped.map((d) => (
              <div key={d.clip_id} className={cx("flex items-center gap-4 rounded-xl border border-dashed border-line px-4 py-3 opacity-60")}>
                <span className="display w-14 text-2xl text-dim">{d.old_rank}<span className="mx-1 text-base">→</span>✕</span>
                <span className="flex-1 truncate text-[14px] line-through">{d.title}</span>
                <Chip tone="rose">dropped</Chip>
              </div>
            ))}
          </div>
          <a href="#/studio" className="mt-4 inline-block text-[13px] text-coral hover:underline">Open the learned brain in the Studio →</a>
        </Card>
      )}
    </div>
  );
}

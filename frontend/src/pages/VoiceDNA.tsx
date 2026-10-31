import { useEffect, useState } from "react";
import { Dna, Mic, Sparkles } from "lucide-react";
import { api, Rule } from "../api";
import { Button, Card, Chip, cx, Empty, PageHeader, Switch, useToast } from "../ui";

export default function VoiceDNA({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<number[]>([]);

  const load = () => api.rules().then(setRules);
  useEffect(() => { load(); }, []);

  async function teach() {
    setBusy(true);
    try {
      const rs = await api.describe(text);
      setFresh(rs.map((r) => r.id));
      setText("");
      toast(rs.length ? `Encore learned ${rs.length} rule${rs.length > 1 ? "s" : ""} from how you described yourself.` : "Nothing new to learn from that.", "learn");
      await load();
      onChange();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  async function toggle(r: Rule, active: boolean) {
    const u = await api.patchRule(r.id, { active });
    setRules((rs) => rs!.map((x) => (x.id === u.id ? u : x)));
    onChange();
  }

  const active = rules?.filter((r) => r.active).length || 0;

  return (
    <div>
      <PageHeader eyebrow="Brand-voice memory" title={<>Voice <em className="text-coral">DNA</em></>}
        sub="Every time you edit a draft, Encore writes down what you changed as a rule. Every future draft follows the rules that are switched on." />

      <Card className="mb-8 p-6">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold"><Mic className="size-4 text-coral" /> Describe how you write, out loud</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Hold your Wispr Flow key and talk for a minute. “I write short, I never use emojis, I like opening with a story, and I mix in Hinglish when it's casual…”"
          className="min-h-[110px] w-full resize-y rounded-xl border border-line bg-ink/60 p-4 text-[15px] leading-relaxed outline-none placeholder:text-dim focus:border-line2" />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[12px] text-dim">Gives Encore starting rules before your first edit.</span>
          <Button variant="primary" onClick={teach} loading={busy} disabled={text.trim().split(/\s+/).length < 5}><Sparkles className="size-4" /> Teach Encore</Button>
        </div>
      </Card>

      <div className="mb-4 flex items-center justify-between">
        <div className="text-[12px] font-semibold uppercase tracking-[.16em] text-mute">{rules?.length || 0} rules · {active} switched on</div>
      </div>

      {rules && !rules.length ? (
        <Empty icon={<Dna className="size-5" />} title="No rules yet" sub="Edit any draft in the Studio, or describe how you write above. Encore turns what you change into rules." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rules?.map((r, i) => (
            <div key={r.id} className={cx("rise flex flex-col rounded-2xl border bg-panel p-5 transition-opacity",
              fresh.includes(r.id) ? "glow border-coral/50" : "border-line", !r.active && "opacity-50")}
              style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="text-[16px] font-semibold leading-snug">{r.rule}</div>
                <Switch on={r.active} onChange={(v) => toggle(r, v)} />
              </div>
              {r.origin === "voice" && r.after && <div className="mt-3 rounded-lg bg-ink/50 p-3 text-[13px] italic leading-relaxed text-mute">{r.after}</div>}
              {(r.before || r.after) && r.origin === "edit" && (
                <div className="mt-3 rounded-lg bg-ink/50 p-3 text-[13px] leading-relaxed">
                  {r.before && <div className="text-rose line-through decoration-rose/50">{r.before}</div>}
                  {r.after && <div className="text-mint">{r.after}</div>}
                </div>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
                <Chip tone={r.origin === "edit" ? "coral" : "gold"}>
                  {r.origin === "edit" ? (r.source_post_id ? `from your edit to post #${r.source_post_id}` : "from an edit")
                    : r.origin === "voice" ? "from what you said in Encore" : "from your spoken description"}
                </Chip>
                {r.reinforced > 0 && <Chip tone="mint">reinforced ×{r.reinforced}</Chip>}
                <span className="ml-auto text-[11px] text-dim">confidence {Math.round(r.confidence * 100)}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

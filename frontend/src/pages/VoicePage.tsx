import { useEffect, useRef, useState } from "react";
import { Dna, ImagePlus, Mic, Plus } from "lucide-react";
import { api } from "../api";
import { Button, Card, PageHeader, useToast } from "../ui";

type Log = Awaited<ReturnType<typeof api.voiceLog>>;

export default function VoicePage() {
  const toast = useToast();
  const shot = useRef<HTMLInputElement>(null);
  const [log, setLog] = useState<Log | null>(null);
  const [text, setText] = useState("");
  const load = () => api.voiceLog().then(setLog);
  useEffect(() => { load(); }, []);

  async function add() {
    try { await api.addLog(text); setText(""); await load(); } catch (e: any) { toast(e.message, "err"); }
  }
  async function upload(f: File) {
    try { await api.uploadShot(f); await load(); toast("Screenshot added."); } catch (e: any) { toast(e.message, "err"); }
  }

  const stats = [
    { label: "Prompts dictated", value: log?.count ?? 0, icon: Mic, tone: "text-coral" },
    { label: "Words spoken to build it", value: log?.words ?? 0, icon: Mic, tone: "text-gold" },
    { label: "Voice DNA rules taught by voice", value: log?.voice_rules ?? 0, icon: Dna, tone: "text-mint" },
  ];

  return (
    <div>
      <PageHeader eyebrow="Built with Wispr Flow" title={<>Built by <em className="text-coral">voice</em></>}
        sub="We built Encore by directing an AI coding agent with Wispr Flow, and creators steer Encore the same way. This is the log." />
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        {stats.map(({ label, value, icon: Icon, tone }) => (
          <Card key={label} className="p-6">
            <Icon className={`mb-4 size-5 ${tone}`} />
            <div className="display text-[64px] leading-none tabular-nums">{value.toLocaleString()}</div>
            <div className="mt-2 text-[13px] text-mute">{label}</div>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          <Card className="mb-4 p-4">
            <div className="flex gap-2">
              <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && add()}
                placeholder="Hold your Flow key and say the prompt you just gave…"
                className="h-10 flex-1 rounded-lg border border-line bg-ink/60 px-3 text-sm outline-none placeholder:text-dim focus:border-line2" />
              <Button variant="primary" onClick={add} disabled={!text.trim()}><Plus className="size-4" /> Log</Button>
            </div>
          </Card>
          <div className="relative space-y-3 pl-6 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-line">
            {log?.entries.map((e) => (
              <div key={e.id} className="relative">
                <span className="absolute -left-6 top-4 size-3.5 rounded-full border-2 border-coral bg-ink" />
                <Card className="p-4">
                  <div className="mono mb-1 text-[11px] text-dim">{new Date(e.created_at + "Z").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {e.who}</div>
                  <div className="text-[14px] leading-relaxed">{e.text}</div>
                </Card>
              </div>
            ))}
            {!log?.entries.length && <div className="text-sm text-dim">No entries yet. Log each prompt as you dictate it.</div>}
          </div>
        </div>
        <Card className="h-fit p-5">
          <div className="mb-3 text-[13px] font-semibold">Wispr Flow stats</div>
          {log?.screenshot ? (
            <img src={`${log.screenshot}?t=${Date.now()}`} className="w-full rounded-lg border border-line" />
          ) : (
            <div className="grid place-items-center rounded-lg border border-dashed border-line2 py-10 text-center text-[13px] text-dim">
              Screenshot of your Flow usage stats
            </div>
          )}
          <input ref={shot} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button className="mt-3 w-full" onClick={() => shot.current?.click()}><ImagePlus className="size-4" /> {log?.screenshot ? "Replace" : "Add"} screenshot</Button>
        </Card>
      </div>
    </div>
  );
}

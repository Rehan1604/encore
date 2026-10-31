import { useEffect, useState } from "react";
import { CalendarDays, GripVertical, X } from "lucide-react";
import { api, localIso, Post, PLATFORM_LABEL } from "../api";
import { Card, Chip, cx, PageHeader, useToast } from "../ui";

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function CalendarPage() {
  const toast = useToast();
  const [posts, setPosts] = useState<Post[]>([]);
  const [sugg, setSugg] = useState<{ hours: number[]; source: string }>({ hours: [9, 13, 18], source: "" });
  const [over, setOver] = useState<number | null>(null);

  const load = () => api.calendar().then((c) => { setPosts(c.posts); setSugg(c.suggested); });
  useEffect(() => { load(); }, []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => new Date(today.getTime() + i * 86400000));
  const latestPerClip = new Map<string, Post>();
  for (const p of posts) {
    const k = `${p.clip_id}-${p.platform}`;
    if (!latestPerClip.has(k)) latestPerClip.set(k, p);
  }
  const ready = [...latestPerClip.values()].filter((p) => !p.scheduled_for && !p.published_at && p.platform !== "shorts_title");
  const scheduled = posts.filter((p) => p.scheduled_for);

  async function drop(dayIdx: number, id: number) {
    const d = new Date(days[dayIdx]);
    const taken = scheduled.filter((p) => sameDay(new Date(p.scheduled_for!), d)).length;
    d.setHours(sugg.hours[taken % sugg.hours.length] ?? 9, 0, 0, 0);
    await api.schedule(id, localIso(d));
    await load();
    toast(`Scheduled for ${d.toLocaleString([], { weekday: "long", hour: "numeric" })}.`);
  }

  async function unschedule(id: number) {
    await api.schedule(id, null);
    await load();
  }

  return (
    <div>
      <PageHeader eyebrow="Content calendar" title={<>Your <em className="text-coral">week</em></>}
        sub={<>Drag a draft onto a day. Encore drops it into the best open slot: {sugg.hours.map((h) => `${h}:00`).join(", ")} <span className="text-dim">({sugg.source})</span>.</>} />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="p-4">
          <div className="mb-3 px-1 text-[12px] font-semibold uppercase tracking-[.14em] text-mute">Ready to schedule · {ready.length}</div>
          <div className="space-y-2">
            {!ready.length && <div className="px-1 py-6 text-center text-[13px] text-dim">Write posts from a clip in the Studio and they show up here.</div>}
            {ready.map((p) => (
              <div key={p.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", String(p.id))}
                className="flex cursor-grab items-start gap-2 rounded-xl border border-line bg-panel2 p-3 active:cursor-grabbing hover:border-line2">
                <GripVertical className="mt-0.5 size-4 shrink-0 text-dim" />
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-coral">{PLATFORM_LABEL[p.platform]}</div>
                  <div className="line-clamp-2 text-[13px] text-text/85">{p.text}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <div className="grid grid-cols-7 gap-2">
          {days.map((d, i) => {
            const items = scheduled.filter((p) => sameDay(new Date(p.scheduled_for!), d))
              .sort((a, b) => +new Date(a.scheduled_for!) - +new Date(b.scheduled_for!));
            return (
              <div key={i}
                onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); const id = Number(e.dataTransfer.getData("text/plain")); id && drop(i, id); }}
                className={cx("min-h-[420px] rounded-2xl border p-2.5 transition-colors", over === i ? "border-coral bg-coral/5" : "border-line bg-panel/60")}>
                <div className="mb-3 px-1">
                  <div className={cx("text-[11px] uppercase tracking-wider", i === 0 ? "text-coral" : "text-dim")}>{i === 0 ? "Today" : d.toLocaleDateString([], { weekday: "short" })}</div>
                  <div className="display text-2xl">{d.getDate()}</div>
                </div>
                <div className="space-y-2">
                  {items.map((p) => (
                    <div key={p.id} className="rise group relative rounded-lg border border-coral/30 bg-coral/[.07] p-2">
                      <button onClick={() => unschedule(p.id)} className="absolute right-1 top-1 hidden text-dim hover:text-text group-hover:block"><X className="size-3.5" /></button>
                      <div className="mono text-[10px] text-coral">{new Date(p.scheduled_for!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
                      <div className="text-[10px] font-semibold text-mute">{PLATFORM_LABEL[p.platform]}</div>
                      <div className="line-clamp-3 text-[12px] leading-snug">{p.text}</div>
                    </div>
                  ))}
                  {!items.length && <div className="px-1 pt-2 text-[11px] text-dim">{sugg.hours[0]}:00 open</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {!scheduled.length && !ready.length && (
        <div className="mt-6 flex items-center gap-2 text-[13px] text-dim"><CalendarDays className="size-4" /> Nothing scheduled yet.</div>
      )}
    </div>
  );
}

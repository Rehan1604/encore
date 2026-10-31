import { useCallback, useEffect, useState } from "react";
import { BarChart3, CalendarDays, Clapperboard, Dna, Mic, ScrollText } from "lucide-react";
import { api, Status } from "./api";
import { cx, ToastProvider } from "./ui";
import Studio from "./pages/Studio";
import VoiceDNA from "./pages/VoiceDNA";
import Performance from "./pages/Performance";
import CalendarPage from "./pages/CalendarPage";
import TracePage from "./pages/TracePage";
import VoicePage from "./pages/VoicePage";

const NAV = [
  { id: "studio", label: "Studio", icon: Clapperboard },
  { id: "voice-dna", label: "Voice DNA", icon: Dna },
  { id: "performance", label: "Performance", icon: BarChart3 },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "trace", label: "AI trace", icon: ScrollText },
  { id: "built-with-voice", label: "Built with voice", icon: Mic },
];

function useHashRoute() {
  const get = () => (window.location.hash.replace(/^#\/?/, "") || "studio").split("?")[0];
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => setRoute(get());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export default function App() {
  const route = useHashRoute();
  const [status, setStatus] = useState<Status | null>(null);
  const refreshStatus = useCallback(() => { api.status().then(setStatus).catch(() => {}); }, []);
  useEffect(() => { refreshStatus(); }, [refreshStatus, route]);

  return (
    <ToastProvider>
      <div className="relative z-10 flex min-h-full">
        <aside className="sticky top-0 flex h-screen w-[232px] shrink-0 flex-col border-r border-line bg-ink/70 px-4 py-6 backdrop-blur">
          <a href="#/studio" className="mb-9 flex items-center gap-2.5 px-2">
            <span className="grid size-8 place-items-center rounded-full bg-coral">
              <svg viewBox="0 0 32 32" className="size-4"><path d="M11 8l13 8-13 8z" fill="#0b0b0d" /></svg>
            </span>
            <span className="display text-[28px] leading-none">Encore</span>
          </a>
          <nav className="flex flex-col gap-1">
            {NAV.map(({ id, label, icon: Icon }) => (
              <a key={id} href={`#/${id}`}
                className={cx("group flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors",
                  route === id ? "bg-panel2 text-text" : "text-mute hover:bg-panel hover:text-text")}>
                <Icon className={cx("size-[17px]", route === id ? "text-coral" : "text-dim group-hover:text-mute")} />
                {label}
                {id === "voice-dna" && !!status?.counts.rules && <span className="ml-auto text-[11px] text-mute">{status.counts.rules}</span>}
                {id === "performance" && !!status?.counts.insights && <span className="ml-auto text-[11px] text-mute">{status.counts.insights}</span>}
              </a>
            ))}
          </nav>
          <div className="mt-auto space-y-3 px-2">
            {status && (
              <div className={cx("rounded-xl border p-3 text-[12px] leading-relaxed",
                status.llm_mock ? "border-gold/30 bg-gold/5 text-gold" : "border-mint/25 bg-mint/5 text-mint")}>
                <div className="flex items-center gap-2 font-semibold">
                  <span className={cx("size-1.5 rounded-full pulse-dot", status.llm_mock ? "bg-gold" : "bg-mint")} />
                  {status.llm_mock ? "Demo mode" : "Live AI"}
                </div>
                <div className="mt-1 text-mute">
                  {status.llm_mock ? "Add GROQ_API_KEY to .env for real AI." : `${status.llm_model} · ${status.whisper_model}`}
                </div>
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-dim">Steer it by voice with Wispr Flow.</p>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-10 py-9">
          <div className="mx-auto max-w-[1280px]">
            {route === "studio" && <Studio onChange={refreshStatus} />}
            {route === "voice-dna" && <VoiceDNA onChange={refreshStatus} />}
            {route === "performance" && <Performance onChange={refreshStatus} />}
            {route === "calendar" && <CalendarPage />}
            {route === "trace" && <TracePage />}
            {route === "built-with-voice" && <VoicePage />}
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}

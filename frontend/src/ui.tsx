import { createContext, ReactNode, useCallback, useContext, useState } from "react";
import { Loader2 } from "lucide-react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "soft"; loading?: boolean; size?: "sm" | "md";
};
export function Button({ variant = "soft", loading, size = "md", className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all select-none",
        "disabled:opacity-50 disabled:cursor-not-allowed active:scale-[.98]",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-coral text-ink hover:brightness-110 shadow-[0_8px_30px_-10px_rgba(255,91,56,.7)]",
        variant === "soft" && "bg-panel2 border border-line text-text hover:border-line2 hover:bg-[#202026]",
        variant === "ghost" && "text-mute hover:text-text hover:bg-panel2",
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx("rounded-2xl border border-line bg-panel/90 backdrop-blur", className)}>{children}</div>;
}

export function Chip({ children, tone = "default", className }: { children: ReactNode; tone?: "default" | "coral" | "gold" | "mint" | "rose"; className?: string }) {
  const tones = {
    default: "border-line2 text-mute bg-panel2",
    coral: "border-coral/40 text-coral bg-coral/10",
    gold: "border-gold/40 text-gold bg-gold/10",
    mint: "border-mint/40 text-mint bg-mint/10",
    rose: "border-rose/40 text-rose bg-rose/10",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] leading-5", tones[tone], className)}>{children}</span>;
}

export function ScoreRing({ score, size = 48 }: { score: number; size?: number }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#27272e" strokeWidth="4" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#f2c14e" strokeWidth="4" fill="none"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round" style={{ transition: "stroke-dashoffset .8s" }} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[13px] font-semibold text-gold">{Math.round(score)}</span>
    </div>
  );
}

export function PageHeader({ eyebrow, title, sub, right }: { eyebrow?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="mb-2 text-[11px] font-semibold uppercase tracking-[.18em] text-coral">{eyebrow}</div>}
        <h1 className="display text-[44px] leading-[1.05]">{title}</h1>
        {sub && <p className="mt-2 max-w-2xl text-[15px] text-mute">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className={cx("relative h-5 w-9 rounded-full transition-colors", on ? "bg-mint" : "bg-line2")} aria-pressed={on}>
      <span className={cx("absolute top-0.5 size-4 rounded-full bg-ink transition-all", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

export function Empty({ icon, title, sub, action }: { icon: ReactNode; title: string; sub: string; action?: ReactNode }) {
  return (
    <Card className="grid place-items-center px-6 py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-panel2 text-mute">{icon}</div>
      <div className="display text-2xl">{title}</div>
      <p className="mt-1 max-w-md text-sm text-mute">{sub}</p>
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}

type Toast = { id: number; text: string; tone: "ok" | "err" | "learn" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "err" ? 7000 : 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex w-[360px] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cx("rise rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur",
            t.tone === "err" && "border-rose/40 bg-[#2a1418]/95 text-rose",
            t.tone === "ok" && "border-line2 bg-panel2/95 text-text",
            t.tone === "learn" && "border-coral/50 bg-[#2a1610]/95 text-text")}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

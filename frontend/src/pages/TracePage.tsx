import { useEffect, useState } from "react";
import { ChevronDown, ScrollText } from "lucide-react";
import { api, TraceRow } from "../api";
import { Card, Chip, cx, Empty, PageHeader } from "../ui";

export default function TracePage() {
  const [rows, setRows] = useState<TraceRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { api.trace().then(setRows); }, []);

  return (
    <div>
      <PageHeader eyebrow="Glass box" title={<>AI <em className="text-coral">trace</em></>}
        sub="Every decision Encore made: what went into the model, what came out, and how long it took." />
      {rows && !rows.length ? (
        <Empty icon={<ScrollText className="size-5" />} title="No AI calls yet" sub="Upload a video in the Studio and every step shows up here." />
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {rows?.map((r) => (
            <div key={r.id}>
              <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-panel2/60">
                <span className={cx("size-2 rounded-full", r.ok ? "bg-mint" : "bg-rose")} />
                <span className="w-48 shrink-0 text-[14px] font-medium">{r.step}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-mute">{r.input_summary}</span>
                {r.mock && <Chip tone="gold">demo</Chip>}
                <span className="mono w-28 shrink-0 truncate text-right text-[11px] text-dim">{r.model}</span>
                <span className="mono w-16 shrink-0 text-right text-[12px] text-mute">{(r.ms / 1000).toFixed(1)}s</span>
                <ChevronDown className={cx("size-4 text-dim transition-transform", open === r.id && "rotate-180")} />
              </button>
              {open === r.id && (
                <pre className="mono max-h-[420px] overflow-auto bg-ink/70 px-5 py-4 text-[12px] leading-relaxed text-text/80">{r.output_json}</pre>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

"""Read LinkedIn analytics exports (.xlsx). Both the all-posts and single-post exports are handled
by scanning for headers instead of trusting fixed column positions."""
import io
import re
from datetime import datetime

import openpyxl

METRICS = {
    "impressions": ("impression",),
    "reactions": ("reaction", "like"),
    "comments": ("comment",),
    "reposts": ("repost", "share"),
    "engagements": ("engagement",),
}


def activity_id(url: str) -> str:
    m = re.search(r"(\d{16,20})", url or "")
    return m.group(1) if m else ""


def _metric(header: str) -> str | None:
    h = header.lower()
    if "rate" in h or "%" in h:
        return None
    for key, words in METRICS.items():
        if any(w in h for w in words):
            return key
    return None


def _to_int(v) -> int | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    s = re.sub(r"[,\s]", "", str(v))
    return int(float(s)) if re.fullmatch(r"\d+(\.\d+)?", s) else None


def _date(v) -> str:
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v) if v else ""


def parse_xlsx(data: bytes) -> list[dict]:
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    found: dict[str, dict] = {}
    single: dict = {}
    for ws in wb.worksheets:
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        i = 0
        while i < len(rows):
            cells = [str(c).strip() if c is not None else "" for c in rows[i]]
            low = [c.lower() for c in cells]
            # key/value rows, as in a single-post export
            if len(cells) >= 2 and cells[0]:
                key = _metric(cells[0])
                val = _to_int(rows[i][1])
                if key and val is not None:
                    single[key] = val
                if "url" in low[0] and "http" in cells[1].lower():
                    single["url"] = cells[1]
            # table header rows, as in the all-posts export (tables may sit side by side)
            url_cols = [j for j, c in enumerate(low) if "url" in c or c in ("post link", "link")]
            if url_cols and any(_metric(c) for c in cells):
                bounds = url_cols + [len(cells)]
                groups = []
                for g in range(len(url_cols)):
                    cols = range(bounds[g], bounds[g + 1])
                    groups.append({
                        "url": bounds[g],
                        "date": next((j for j in cols if "date" in low[j]), None),
                        "metrics": {j: _metric(cells[j]) for j in cols if _metric(cells[j])},
                    })
                k = i + 1
                while k < len(rows):
                    row = rows[k]
                    if not any(c not in (None, "") for c in row):
                        break
                    for g in groups:
                        url = str(row[g["url"]] or "").strip() if g["url"] < len(row) else ""
                        if not url.startswith("http"):
                            continue
                        aid = activity_id(url)
                        entry = found.setdefault(aid or url, {"url": url, "activity_id": aid, "date": ""})
                        if g["date"] is not None and g["date"] < len(row):
                            entry["date"] = entry["date"] or _date(row[g["date"]])
                        for j, key in g["metrics"].items():
                            v = _to_int(row[j]) if j < len(row) else None
                            if v is not None:
                                entry[key] = v
                    k += 1
                i = k
            i += 1
    out = list(found.values())
    if not out and single:
        out = [{"url": single.get("url", ""), "activity_id": activity_id(single.get("url", "")), "date": "",
                **{k: v for k, v in single.items() if k != "url"}}]
    for e in out:
        if "reactions" not in e and "engagements" in e:
            e["reactions"] = e["engagements"]          # only a total was exported
            e["note"] = "only total engagements exported; counted as reactions"
        for k in ("impressions", "reactions", "comments", "reposts"):
            e.setdefault(k, 0)
    return out

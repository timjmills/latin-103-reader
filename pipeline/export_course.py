"""Write app/data/course.json: public metadata for all 14 weeks (numbers,
titles, reading references, grammar focus). No passage text — this ships with
the public shell so the weeks menu can list the whole course before the
texts are seeded."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import weeks

ROOT = Path(__file__).resolve().parent.parent
out = []
for n in range(1, 15):
    w = weeks.week_meta(n)
    out.append({
        "n": n, "id": w["id"], "title": w["title"], "source": w["source"],
        "chapter": w.get("chapter"),
        "reading": " · ".join(t["ref"] for t in w.get("texts", [])) or w.get("chapter", ""),
        "focus": {"key": w["focus"]["key"], "label": w["focus"]["label"], "blurb": w["focus"].get("blurb", "")},
    })
dest = ROOT / "app" / "data" / "course.json"
dest.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"wrote {dest} ({len(out)} weeks)")

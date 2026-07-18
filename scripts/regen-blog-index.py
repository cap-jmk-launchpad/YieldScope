import json
import re
from pathlib import Path

d = Path("web/content/blog")
posts = []
for p in sorted(d.glob("*.md")):
    raw = p.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n", raw, re.S)
    meta = {}
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                v = v.strip().strip('"')
                meta[k.strip()] = v
    posts.append(
        {
            "slug": p.stem,
            "title": meta.get("title", p.stem),
            "description": meta.get("description", ""),
        }
    )
(d / "index.json").write_text(json.dumps(posts, indent=2) + "\n", encoding="utf-8")
print(f"{len(posts)} posts indexed")
for x in posts:
    print("-", x["title"])

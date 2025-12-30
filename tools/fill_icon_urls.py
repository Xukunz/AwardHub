from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional


# ---------------- Config ----------------
JSON_DIR = Path("data")   # 你的 JSON 在这里；如果在 data/ 就改成 Path("data")
JSON_GLOB = "steam_awards_*.json"

IMG_DIR = Path("img")                  # 你的图片根目录：img/2023/*.jpg 这种
PLACEHOLDER = "img/*"

EXTS = [".jpg", ".jpeg", ".png", ".webp"]
SUFFIXES = ["", "_2", "_3", "_4", "_5"]  # 适配你这种 red_dead_redemption_2.jpg

# ---------------- Utils ----------------
def slugify(text: str) -> str:
    """尽量贴合你现在的文件命名风格：小写、非字母数字变下划线、去掉™®等符号"""
    s = (text or "").strip().lower()
    s = s.replace("&", "and")
    s = s.replace("®", "").replace("™", "")
    s = s.replace("’", "").replace("'", "")
    # 把所有非字母数字变成下划线
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s or "unknown"

def find_image_for(year: int, base_slug: str) -> Optional[str]:
    """在 img/<year>/ 下找匹配的图片文件，返回相对路径（用于网页）"""
    year_dir = IMG_DIR / str(year)
    if not year_dir.exists():
        return None

    for suf in SUFFIXES:
        for ext in EXTS:
            p = year_dir / f"{base_slug}{suf}{ext}"
            if p.exists():
                # 返回网页相对路径
                return f"img/{year}/{p.name}"
    return None

def fill_game_icon(year: int, game_obj: dict) -> None:
    """给单个 game 对象填 icon_url"""
    name = (game_obj.get("game_name") or "").strip()
    if not name:
        game_obj["icon_url"] = PLACEHOLDER
        return

    base_slug = slugify(name)
    img_path = find_image_for(year, base_slug)

    game_obj["icon_url"] = img_path if img_path else PLACEHOLDER

# ---------------- Main ----------------
def main():
    if not JSON_DIR.exists():
        raise SystemExit(f"[ERROR] JSON_DIR not found: {JSON_DIR.resolve()}")

    files = sorted(JSON_DIR.glob(JSON_GLOB))
    if not files:
        raise SystemExit(f"[ERROR] No JSON files matched: {JSON_DIR}/{JSON_GLOB}")

    changed_files = 0
    for fp in files:
        data = json.loads(fp.read_text(encoding="utf-8"))
        year = int(data.get("year"))

        changed = False
        for award in data.get("awards", []):
            winner = award.get("winner")
            if isinstance(winner, dict):
                before = winner.get("icon_url")
                fill_game_icon(year, winner)
                if winner.get("icon_url") != before:
                    changed = True

            nominees = award.get("nominees") or []
            if isinstance(nominees, list):
                for nom in nominees:
                    if not isinstance(nom, dict):
                        continue
                    before = nom.get("icon_url")
                    fill_game_icon(year, nom)
                    if nom.get("icon_url") != before:
                        changed = True

        if changed:
            fp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            changed_files += 1
            print(f"[OK] Updated icons in {fp.name}")
        else:
            print(f"[SKIP] No changes for {fp.name}")

    print(f"\nDone. Updated {changed_files}/{len(files)} files.")

if __name__ == "__main__":
    main()



#!/usr/bin/env python3
"""
Populate BGG profile URLs and short write-ups for designers/publishers in data/content.json.

Usage:
  python3 scripts/fetch_bgg_profiles.py --dry-run
  python3 scripts/fetch_bgg_profiles.py --write
  python3 scripts/fetch_bgg_profiles.py --write --force
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

BGG_BASE = "https://boardgamegeek.com"
DEFAULT_PATH = Path("data/content.json")
USER_AGENT = "PnPLaunchpadBGGFetcher/1.0 (+manual curation)"

PROFILE_PATTERNS = {
    "designers": re.compile(r'href="(/boardgamedesigner/\d+/[^"]+)"[^>]*>(.*?)</a>', re.I | re.S),
    "publishers": re.compile(r'href="(/boardgamepublisher/\d+/[^"]+)"[^>]*>(.*?)</a>', re.I | re.S),
}


def fetch_text(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def clean_text(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    value = html.unescape(value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def search_bgg_person(name: str, kind: str) -> Optional[str]:
    objecttype = "boardgamedesigner" if kind == "designers" else "boardgamepublisher"
    q = urllib.parse.quote(name)
    url = f"{BGG_BASE}/geeksearch.php?action=search&objecttype={objecttype}&q={q}"
    page = fetch_text(url)

    pattern = PROFILE_PATTERNS[kind]
    candidates: List[Tuple[str, str]] = []
    for href, label in pattern.findall(page):
        candidates.append((href, clean_text(label)))

    if not candidates:
        return None

    target = normalize(name)
    for href, label in candidates:
        if normalize(label) == target:
            return urllib.parse.urljoin(BGG_BASE, href)

    return urllib.parse.urljoin(BGG_BASE, candidates[0][0])


def extract_writeup(profile_html: str) -> str:
    og = re.search(r'<meta\s+property="og:description"\s+content="([^"]+)"', profile_html, re.I)
    if og:
        return clean_text(og.group(1))

    md = re.search(r'<meta\s+name="description"\s+content="([^"]+)"', profile_html, re.I)
    if md:
        return clean_text(md.group(1))

    p = re.search(r"<p[^>]*>(.*?)</p>", profile_html, re.I | re.S)
    if p:
        return clean_text(p.group(1))

    return ""


def update_entries(data: Dict, kind: str, force: bool, delay_ms: int) -> List[str]:
    entries = data.get(kind, [])
    updated: List[str] = []

    for idx, entry in enumerate(entries):
        name = str(entry.get("name", "")).strip()
        if not name:
            continue

        has_url = bool(str(entry.get("bggUrl", "")).strip())
        has_bio = bool(str(entry.get("bio", "")).strip())
        if not force and has_url and has_bio:
            continue

        try:
            profile_url = search_bgg_person(name, kind)
            if not profile_url:
                continue

            profile_page = fetch_text(profile_url)
            writeup = extract_writeup(profile_page)

            entry["bggUrl"] = profile_url
            if writeup:
                entry["bio"] = writeup

            updated.append(f"{kind}:{name}")
        except Exception as exc:
            print(f"WARN: failed {kind}:{name} -> {exc}", file=sys.stderr)

        if idx < len(entries) - 1 and delay_ms > 0:
            time.sleep(delay_ms / 1000)

    return updated


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch BGG profile URLs and write-ups.")
    parser.add_argument("--path", type=Path, default=DEFAULT_PATH, help="Path to content JSON")
    parser.add_argument("--write", action="store_true", help="Write changes back to file")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing (default)")
    parser.add_argument("--force", action="store_true", help="Refetch even if bggUrl/bio already exist")
    parser.add_argument("--delay-ms", type=int, default=500, help="Delay between requests per section")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not args.path.exists():
        print(f"ERROR: file not found: {args.path}", file=sys.stderr)
        return 1

    with args.path.open() as f:
        data = json.load(f)

    updated = []
    updated.extend(update_entries(data, "designers", args.force, args.delay_ms))
    updated.extend(update_entries(data, "publishers", args.force, args.delay_ms))

    if not updated:
        print("No entries updated.")
        return 0

    print("Updated entries:")
    for item in updated:
        print(f"- {item}")

    should_write = args.write and not args.dry_run
    if should_write:
        with args.path.open("w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        print(f"\nWrote changes to: {args.path}")
    else:
        print("\nDry-run mode: no file changes written. Use --write to save.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

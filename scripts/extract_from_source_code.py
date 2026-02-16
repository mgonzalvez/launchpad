#!/usr/bin/env python3
"""
Extract relevant project links from a large Facebook source_code.txt dump.

This script is designed to avoid loading huge raw source files into chat context.
It performs local parsing, decoding, filtering, and de-duplication.

Usage:
  python3 scripts/extract_from_source_code.py
  python3 scripts/extract_from_source_code.py --input "Feb. 9-14, 2026/source_code.txt"
  python3 scripts/extract_from_source_code.py --csv "Feb. 9-14, 2026/source_code_extracted.csv"
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import sys
import urllib.parse
from pathlib import Path
from typing import Dict, List, Optional

URL_RE = re.compile(r"https?://[^\s\"'<>]+")
LFB_RE = re.compile(r"^https?://l\.facebook\.com/l\.php\?(.*)$", re.I)

PROJECT_HOSTS = {
    "kickstarter.com",
    "www.kickstarter.com",
    "gamefound.com",
    "www.gamefound.com",
    "itch.io",
    "www.itch.io",
    "etsy.com",
    "www.etsy.com",
    "youtube.com",
    "www.youtube.com",
    "youtu.be",
    "drive.google.com",
}


def clean_source(raw: str) -> str:
    # Handle HTML entities and JSON-style escaped slashes found in script blobs.
    text = html.unescape(raw)
    text = text.replace("\\/", "/")
    return text


def normalize_url(url: str) -> str:
    # Trim common trailing punctuation captured by broad regex.
    url = url.rstrip(").,;\"' ")
    # Strip escaped/newline tails seen in JSON-encoded text blobs.
    for marker in ("\\n", "\\r", "\n", "\r", "\\u000a", "\\u000d"):
        if marker in url:
            url = url.split(marker, 1)[0]
    return url.rstrip(").,;\"' ")


def decode_lfacebook_redirect(url: str) -> Optional[str]:
    m = LFB_RE.match(url)
    if not m:
        return None
    query = urllib.parse.parse_qs(m.group(1))
    target = query.get("u", [None])[0]
    if not target:
        return None
    return normalize_url(urllib.parse.unquote(target))


def parse_host(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).netloc.lower()
    except Exception:
        return ""


def platform_for(url: str) -> str:
    host = parse_host(url)
    if "kickstarter.com" in host:
        return "Kickstarter"
    if "gamefound.com" in host:
        return "Gamefound"
    if "itch.io" in host:
        return "Itch.io"
    if "etsy.com" in host:
        return "Etsy"
    if "youtube.com" in host or "youtu.be" in host:
        return "YouTube"
    if "drive.google.com" in host:
        return "Google Drive"
    return "Other"


def is_relevant_project_url(url: str) -> bool:
    host = parse_host(url)
    if host not in PROJECT_HOSTS:
        return False

    path = urllib.parse.urlparse(url).path.lower()

    # Exclude obvious media/assets links rather than project pages.
    if host.endswith("kickstarter.com") and path.startswith("/assets/"):
        return False
    if host.endswith("itch.io") and path.startswith("/images/"):
        return False

    # Favor known campaign/listing patterns.
    if host.endswith("kickstarter.com"):
        return "/projects/" in path
    if host.endswith("gamefound.com"):
        return "/projects/" in path
    if host.endswith("etsy.com"):
        return "/listing/" in path
    if host.endswith("drive.google.com"):
        return "/file/" in path or "/drive/" in path
    if host.endswith("youtube.com") or host == "youtu.be":
        return True
    if host.endswith("itch.io"):
        return True
    return False


def canonicalize(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower()
    path = parsed.path.rstrip("/")

    # Keep only stable query params that matter for YouTube watch URLs.
    query = ""
    if "youtube.com" in host and parsed.path == "/watch":
        params = urllib.parse.parse_qs(parsed.query)
        if "v" in params:
            query = urllib.parse.urlencode({"v": params["v"][0]})

    return urllib.parse.urlunparse((parsed.scheme, host, path, "", query, ""))


def compact_snippet(text: str, idx: int, radius: int = 180) -> str:
    left = max(0, idx - radius)
    right = min(len(text), idx + radius)
    snippet = text[left:right]
    snippet = re.sub(r"\s+", " ", snippet).strip()
    return snippet


def extract_records(text: str, source_file: Path) -> List[Dict]:
    records: List[Dict] = []
    for m in URL_RE.finditer(text):
        raw_url = normalize_url(m.group(0))
        source_kind = "direct"
        resolved = raw_url

        redirected = decode_lfacebook_redirect(raw_url)
        if redirected:
            source_kind = "l_facebook_redirect"
            resolved = redirected

        resolved = normalize_url(resolved)
        if not is_relevant_project_url(resolved):
            continue

        snippet = compact_snippet(text, m.start())
        if "ClickIDURLBlocklistSVConfig" in snippet:
            continue
        if "block_list_url" in snippet:
            continue

        plat = platform_for(resolved)
        if plat == "YouTube":
            if (
                'body":{"text"' not in snippet
                and "Link for Folding" not in snippet
                and "Play through video" not in snippet
                and "youtu.be/" not in snippet
            ):
                continue

        rec = {
            "source_file": str(source_file),
            "offset": m.start(),
            "source_kind": source_kind,
            "raw_url": raw_url,
            "resolved_url": resolved,
            "canonical_url": canonicalize(resolved),
            "platform": plat,
            "context_snippet": snippet,
        }
        records.append(rec)
    return records


def dedupe(records: List[Dict]) -> List[Dict]:
    seen: Dict[str, Dict] = {}
    for rec in records:
        key = rec["canonical_url"]
        if key not in seen:
            seen[key] = rec
    return list(seen.values())


def default_input() -> Optional[Path]:
    candidates = sorted(Path(".").glob("*/source_code.txt"), key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def write_csv(path: Path, records: List[Dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "platform",
        "canonical_url",
        "resolved_url",
        "source_kind",
        "offset",
        "source_file",
        "context_snippet",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for rec in records:
            w.writerow({k: rec.get(k, "") for k in fields})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract project links from source_code.txt")
    parser.add_argument("--input", type=Path, help="Path to source_code.txt (default: newest */source_code.txt)")
    parser.add_argument("--output", type=Path, help="Output JSON path (default: next to input)")
    parser.add_argument("--csv", type=Path, help="Optional CSV output path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = args.input or default_input()
    if not input_path:
        print("ERROR: no source_code.txt found. Pass --input path/to/source_code.txt", file=sys.stderr)
        return 1
    if not input_path.exists():
        print(f"ERROR: input not found: {input_path}", file=sys.stderr)
        return 1

    output_path = args.output or input_path.with_name("source_code_extracted.json")
    csv_path = args.csv

    text = clean_source(input_path.read_text(encoding="utf-8", errors="replace"))
    all_records = extract_records(text, input_path)
    unique_records = dedupe(all_records)

    result = {
        "input_file": str(input_path),
        "counts": {
            "relevant_records": len(all_records),
            "unique_urls": len(unique_records),
        },
        "unique_records": unique_records,
        "all_records": all_records,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if csv_path:
        write_csv(csv_path, unique_records)

    print(f"Wrote JSON: {output_path}")
    if csv_path:
        print(f"Wrote CSV: {csv_path}")
    print(f"Counts: relevant_records={len(all_records)} unique_urls={len(unique_records)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

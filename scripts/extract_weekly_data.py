#!/usr/bin/env python3
"""
Extract structured weekly project/link data from markdown notes.

Designed for files like:
  */extracted_text_and_urls.md

Usage:
  python3 scripts/extract_weekly_data.py --input "Feb. 9-14, 2026/extracted_text_and_urls.md"
  python3 scripts/extract_weekly_data.py --input "Feb. 9-14, 2026/extracted_text_and_urls.md" --csv data/weekly_extracted.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional

URL_RE = re.compile(r"`(https?://[^`]+)`")
SCREENSHOT_RE = re.compile(r"^## Screenshot `([^`]+)`\s*$")
SECTION_RE = re.compile(r"^##\s+(.+?)\s*$")


def detect_platform(url: str) -> str:
    value = url.lower()
    if "kickstarter.com" in value:
        return "Kickstarter"
    if "gamefound.com" in value:
        return "Gamefound"
    if "itch.io" in value:
        return "Itch.io"
    if "etsy.com" in value:
        return "Etsy"
    if "youtu.be" in value or "youtube.com" in value:
        return "YouTube"
    if "drive.google.com" in value:
        return "Google Drive"
    return "Other"


def url_quality(url: str) -> str:
    if "..." in url:
        return "truncated"
    if "<creator>" in url:
        return "template"
    return "full"


def parse_creator_block(lines: List[str], start_idx: int) -> Optional[Dict]:
    line = lines[start_idx]
    if not line.startswith("- ") or line.startswith("- `"):
        return None

    creator = line[2:].strip()
    if not creator:
        return None

    details: List[str] = []
    urls: List[str] = []
    i = start_idx + 1
    while i < len(lines):
        child = lines[i]
        if not child.startswith("  - "):
            break
        content = child[4:].strip()
        details.append(content)
        urls.extend(URL_RE.findall(content))
        i += 1

    if not details:
        return None

    return {
        "creator": creator,
        "details": details,
        "urls": list(dict.fromkeys(urls)),
        "next_index": i,
    }


def parse_markdown(path: Path) -> Dict:
    raw = path.read_text(encoding="utf-8")
    lines = raw.splitlines()

    records: List[Dict] = []
    all_urls: List[Dict] = []

    current_h2 = ""
    current_screenshot = ""
    i = 0
    while i < len(lines):
        line = lines[i]

        m_s = SCREENSHOT_RE.match(line)
        if m_s:
            current_screenshot = m_s.group(1)
            current_h2 = line[3:].strip()
            i += 1
            continue

        m_h2 = SECTION_RE.match(line)
        if m_h2:
            current_h2 = m_h2.group(1).strip()
            if not current_h2.startswith("Screenshot "):
                current_screenshot = ""
            i += 1
            continue

        creator_block = parse_creator_block(lines, i)
        if creator_block and current_screenshot:
            creator = creator_block["creator"]
            for url in creator_block["urls"]:
                rec = {
                    "source_file": str(path),
                    "screenshot": current_screenshot,
                    "creator": creator,
                    "url": url,
                    "url_quality": url_quality(url),
                    "platform": detect_platform(url),
                    "section": current_h2,
                }
                records.append(rec)
                all_urls.append(rec)

            i = int(creator_block["next_index"])
            continue

        for url in URL_RE.findall(line):
            rec = {
                "source_file": str(path),
                "screenshot": current_screenshot,
                "creator": "",
                "url": url,
                "url_quality": url_quality(url),
                "platform": detect_platform(url),
                "section": current_h2,
            }
            all_urls.append(rec)

        i += 1

    unique_project_urls = {}
    for rec in records:
        key = rec["url"]
        if key not in unique_project_urls:
            unique_project_urls[key] = rec

    unique_all_urls = {}
    for rec in all_urls:
        key = rec["url"]
        if key not in unique_all_urls:
            unique_all_urls[key] = rec

    result = {
        "input_file": str(path),
        "counts": {
            "source_records": len(records),
            "unique_source_urls": len(unique_project_urls),
            "all_urls_seen": len(all_urls),
            "unique_all_urls": len(unique_all_urls),
        },
        "source_records": records,
        "unique_source_urls": list(unique_project_urls.values()),
        "unique_all_urls": list(unique_all_urls.values()),
    }
    return result


def write_csv(path: Path, records: List[Dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["screenshot", "creator", "platform", "url_quality", "url", "section", "source_file"]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for rec in records:
            writer.writerow({k: rec.get(k, "") for k in fields})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract structured weekly links from markdown notes.")
    parser.add_argument(
        "--input",
        type=Path,
        help="Path to extracted_text_and_urls.md (default: newest */extracted_text_and_urls.md)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/weekly_extracted.json"),
        help="Output JSON path (default: data/weekly_extracted.json)",
    )
    parser.add_argument("--csv", type=Path, help="Optional CSV output path")
    return parser.parse_args()


def find_latest_input() -> Optional[Path]:
    candidates = sorted(Path(".").glob("*/extracted_text_and_urls.md"), key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def main() -> int:
    args = parse_args()
    input_path = args.input or find_latest_input()
    if not input_path:
        print("ERROR: no input file found. Pass --input path/to/extracted_text_and_urls.md", file=sys.stderr)
        return 1
    if not input_path.exists():
        print(f"ERROR: input file not found: {input_path}", file=sys.stderr)
        return 1

    result = parse_markdown(input_path)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")

    if args.csv:
        write_csv(args.csv, result["source_records"])

    print(f"Wrote JSON: {args.output}")
    if args.csv:
        print(f"Wrote CSV: {args.csv}")
    print(
        "Counts:",
        f"source_records={result['counts']['source_records']}",
        f"unique_source_urls={result['counts']['unique_source_urls']}",
        f"unique_all_urls={result['counts']['unique_all_urls']}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

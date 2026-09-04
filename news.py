#!/usr/bin/env python3
"""
Gather anything published about Killeshin from the local news sites.

Free titles are checked first and lead the list in the app. Anything behind a
subscription is kept, but tagged so it can be grouped and badged separately.

    pip install requests beautifulsoup4
    python news.py            # writes data/news.json
"""

import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from xml.etree import ElementTree as ET

import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "news.json")
HEADERS = {"User-Agent": "KilleshinGAA-Fixtures/1.0 (club news reader)"}
KEEP = 30            # how many stories to hold
MAX_AGE_DAYS = 550   # roughly a season and a half

# What counts as a Killeshin story.
MATCH = re.compile(r"killeshin|gleann uiseann|seamus hearns park|p[áa]irc uisean", re.I)

# ---------------------------------------------------------------------------
# SOURCES — free ones first, and they stay first in the app.
#
# access:
#   "free"       every story reads in full
#   "subscriber" everything sits behind a paywall
#   "mixed"      use paid_when below to decide per story
#
# If a title changes its paywall, edit it here and nowhere else.
# ---------------------------------------------------------------------------
SOURCES = [
    {"name": "Leinster Express",   "access": "free",
     "feeds": ["https://www.leinsterexpress.ie/rss/",
               "https://www.leinsterexpress.ie/feed/"],
     "pages": ["https://www.leinsterexpress.ie/sport/gaa"]},

    {"name": "Laois Nationalist",  "access": "free",
     "feeds": ["https://www.laois-nationalist.ie/feed/",
               "https://laois-nationalist.ie/feed/"],
     "pages": ["https://www.laois-nationalist.ie/sport/"]},

    {"name": "Carlow Nationalist", "access": "free",
     "feeds": ["https://www.carlow-nationalist.ie/feed/"],
     "pages": ["https://www.carlow-nationalist.ie/sport/gaa/"]},

    {"name": "Laois GAA",          "access": "free",
     "feeds": ["https://laoisgaa.ie/feed/"],
     "pages": ["https://laoisgaa.ie/news/"]},

    # LaoisToday runs a premium sports subscription, so sport is treated as
    # paid and the rest as free. It keeps a Killeshin tag page, which is the
    # richest single source of club coverage anywhere.
    {"name": "LaoisToday",         "access": "mixed",
     "paid_when": ["/sport/", "/gaa/", "premium"],
     "feeds": ["https://www.laoistoday.ie/tag/killeshin/feed/"],
     "pages": ["https://www.laoistoday.ie/tag/killeshin/"]},
]

TAGS = [
    ("Ladies",    r"lgfa|ladies"),
    ("Schools",   r"cumann na mbunscol|national school|\bns\b|schools"),
    ("Club",      r"fundrais|lotto|agm|committee|development|grant|sponsor"),
    ("Community", r"community|heritage|parish|funeral|passing|death"),
    ("GAA",       r"."),          # default
]


def tag_of(title):
    for name, pat in TAGS:
        if re.search(pat, title, re.I):
            return name
    return "GAA"


def access_of(src, url):
    if src["access"] != "mixed":
        return src["access"]
    low = url.lower()
    return "subscriber" if any(h in low for h in src.get("paid_when", [])) else "free"


def norm_date(raw):
    """RSS dates come in several shapes; fall back to today rather than drop."""
    if not raw:
        return None
    raw = raw.strip()
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z",
                "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", raw)
    return m.group(0) if m else None


def get(url):
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        if r.status_code == 200 and r.content:
            return r
    except requests.RequestException as e:
        print("    ! %s (%s)" % (url, type(e).__name__))
    return None


def from_feed(src, url):
    """Read an RSS/Atom feed. Headline, date and link only — never body text."""
    r = get(url)
    if not r:
        return []
    try:
        root = ET.fromstring(r.content)
    except ET.ParseError:
        return []

    out = []
    items = root.iter("item")
    for it in items:
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        date = norm_date(it.findtext("pubDate"))
        if title and link:
            out.append((title, link, date))
    if not out:  # Atom
        ns = "{http://www.w3.org/2005/Atom}"
        for it in root.iter(ns + "entry"):
            title = (it.findtext(ns + "title") or "").strip()
            ln = it.find(ns + "link")
            link = ln.get("href") if ln is not None else ""
            date = norm_date(it.findtext(ns + "updated") or it.findtext(ns + "published"))
            if title and link:
                out.append((title, link, date))
    return out


def from_page(src, url):
    """Fallback: read headlines off a section or tag page."""
    r = get(url)
    if not r:
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    out, seen = [], set()
    for h in soup.find_all(["h1", "h2", "h3", "h4"]):
        a = h.find("a", href=True) or (h.parent.find("a", href=True) if h.parent else None)
        if not a:
            continue
        title = re.sub(r"\s+", " ", h.get_text(" ", strip=True))
        link = requests.compat.urljoin(url, a["href"])
        if len(title) < 20 or link in seen:
            continue
        seen.add(link)
        # try to find a date near the headline
        blob = h.parent.get_text(" ", strip=True) if h.parent else ""
        m = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Z][a-z]{2,8})\s+(\d{4})", blob)
        date = None
        if m:
            try:
                date = datetime.strptime("%s %s %s" % (m.group(1), m.group(2)[:3], m.group(3)),
                                         "%d %b %Y").strftime("%Y-%m-%d")
            except ValueError:
                pass
        m2 = re.search(r"/(\d{4})/(\d{2})/(\d{2})/", link)
        if not date and m2:
            date = "%s-%s-%s" % m2.groups()
        out.append((title, link, date))
    return out


def main():
    today = datetime.now(timezone(timedelta(hours=1)))
    stories, seen = [], set()

    for src in SOURCES:
        print("%s (%s)" % (src["name"], src["access"]))
        found = []
        for feed in src.get("feeds", []):
            found = from_feed(src, feed)
            if found:
                print("    feed ok: %d items" % len(found))
                break
        if not found:
            for page in src.get("pages", []):
                found = from_page(src, page)
                if found:
                    print("    page ok: %d items" % len(found))
                    break
        if not found:
            print("    nothing read")
            continue

        kept = 0
        for title, link, date in found:
            if not MATCH.search(title) and not MATCH.search(link):
                continue
            key = re.sub(r"[^a-z0-9]", "", title.lower())[:70]
            if key in seen:
                continue
            seen.add(key)
            if date:
                try:
                    if (today.date() - datetime.strptime(date, "%Y-%m-%d").date()).days > MAX_AGE_DAYS:
                        continue
                except ValueError:
                    date = None
            stories.append({
                "date": date or today.strftime("%Y-%m-%d"),
                "title": title,
                "source": src["name"],
                "tag": tag_of(title),
                "access": access_of(src, link),
                "url": link,
            })
            kept += 1
        print("    Killeshin stories: %d" % kept)

    # Newest first; free ahead of subscriber where dates tie.
    stories.sort(key=lambda s: (s["date"], s["access"] == "free"), reverse=True)
    stories = stories[:KEEP]

    free = sum(1 for s in stories if s["access"] == "free")
    print("\nTotal: %d  (free %d, subscriber %d)" % (len(stories), free, len(stories) - free))

    if not stories:
        print("No Killeshin stories found. Not overwriting the existing file.", file=sys.stderr)
        sys.exit(1)

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"updated": today.isoformat(timespec="seconds"),
                   "sources": [{"name": s["name"], "access": s["access"]} for s in SOURCES],
                   "news": stories}, fh, ensure_ascii=False, separators=(",", ":"))
    print("Wrote", OUT)


if __name__ == "__main__":
    main()

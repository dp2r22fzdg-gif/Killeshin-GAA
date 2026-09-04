#!/usr/bin/env python3
"""
Pull every Killeshin fixture, result and league table from both county boards.

The men's club runs on laoisgaa.ie as "Gleann Uiseann"; the ladies club runs on
laoislgfa.ie as "Killeshin". Both sites are built on the same Club & County
platform, so one parser handles the pair — only the URL and club name differ.

    pip install requests beautifulsoup4
    python scrape.py        # writes killeshin.json, then the .ics feeds

Exits non-zero if a branch comes back empty, so a scheduled run fails loudly
rather than quietly replacing good data with nothing.
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone, timedelta

import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "killeshin.json")
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IE,en;q=0.9",
    "Connection": "keep-alive",
}
TRIES = 3          # county sites drop the odd connection; don't fail on the first
TIMEOUT = 60

BRANCHES = {
    "men": {
        "name": "Men's",
        "team": "Gleann Uiseann",
        "crest": "crest.png",
        "source": ("https://laoisgaa.ie/fixtures-results/team/gleann-uiseann/"
                   "6547884c-ea64-5502-8472-8eb26b092437/"),
    },
    "ladies": {
        "name": "Ladies",
        "team": "Killeshin",
        "crest": "crest-ladies.png",
        "source": ("https://laoislgfa.ie/fixtures-results/team/killeshin/"
                   "6063df22-0a35-9537-87e6-5276dfa17357/"),
    },
}

GROUND = "Seamus Hearns Park"
MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}

# Order the grade chips appear in, oldest age group first.
GRADE_ORDER = ["Senior", "Intermediate", "Junior", "Adult League", "Minor",
               "U20", "U17", "U16", "U15", "U14", "U13", "U12", "Féile"]

SCORE_RE = re.compile(r"^\d+-\d+$")
TIME_RE = re.compile(r"^\d{1,2}:\d{2}$")


def fetch(url):
    """Retry a few times before giving up — a single dropped connection is normal."""
    import time
    last = None
    for attempt in range(1, TRIES + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            last = e
            print("    attempt %d/%d failed: %s" % (attempt, TRIES, type(e).__name__))
            if attempt < TRIES:
                time.sleep(attempt * 10)
    print("    giving up: %s" % type(last).__name__)
    return None


def grade_of(comp):
    """Which club team a competition belongs to. Covers both codes."""
    c = comp.lower()
    for n in ("20", "17", "16", "15", "14", "13", "12"):
        if re.search(r"\bu-?%s\b|under[\s-]*%s\b" % (n, n), c):
            return "U" + n
    if "féile" in c or "feile" in c:
        return "Féile"
    if "minor" in c:
        return "Minor"
    if "intermediate" in c:
        return "Intermediate"
    if "junior" in c:
        return "Junior"
    if "acfl" in c or "kelly cup" in c or "division" in c or "adult league" in c:
        return "Adult League"
    if "senior" in c:
        return "Senior"
    return "Other"


def total(score):
    """GAA score to points: 1-13 -> 16."""
    m = SCORE_RE.match((score or "").strip())
    if not m:
        return None
    g, p = score.split("-")
    return int(g) * 3 + int(p)


def tidy(comp):
    """Drop sponsor prefixes so it fits a phone screen."""
    comp = re.sub(r"^(LOETB|Laois Shopping Centre|Midlands Park Hotel|Laois Hire|"
                  r"John West LGFA)\s+", "", (comp or "").strip())
    return re.sub(r"\s+", " ", comp)


def clean(node):
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)) if node else ""


def heading_date(text):
    """'Sunday 6th Sep 2026' -> '2026-09-06'."""
    m = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\s+(\d{4})", text)
    if not m:
        return None
    mon = m.group(2)[:3].title()
    if mon not in MONTHS:
        return None
    return "%s-%02d-%02d" % (m.group(3), MONTHS[mon], int(m.group(1)))


def parse_match(block, date, club, branch):
    """
    Read one match. Both sites lay a match out as competition link, home team,
    scores and time, away team, then venue and referee. Read it by picking out
    the pieces rather than by class names, so a theme tweak doesn't break it.
    """
    bits = [t.strip() for t in block.stripped_strings if t.strip()]
    teams, comp, venue, ref, conceder = [], None, None, None, None

    for a in block.find_all("a"):
        href, text = a.get("href", ""), clean(a)
        if not text:
            continue
        if "/team/" in href:
            name = re.sub(r"\s*\(C\)\s*$", "", text)
            if name != text:
                conceder = name
            teams.append(name)
        elif "/venue/" in href:
            venue = text
        elif COMP_RE.search(href) and comp is None and len(text) > 8:
            comp = text

    if not venue:                       # "Venue: TBC" has no venue link at all
        m = re.search(r"Venue:\s*([^\n]{2,60})", " ".join(bits))
        venue = m.group(1).strip() if m else "TBC"

    if len(teams) < 2:          # BYE entries carry a single team
        return None

    scores = [t for t in bits if SCORE_RE.match(t)]
    times = [t for t in bits if TIME_RE.match(t)]
    conceded = "CONC" in bits

    m = re.search(r"Referee:\s*(.+?)(?:\s{2,}|$)", " ".join(bits))
    if m:
        ref = m.group(1).strip()

    home, away = teams[0], teams[1]
    return {
        "date": date,
        "time": times[0] if times else "TBC",
        "competition": tidy(comp or ""),
        "grade": grade_of(comp or ""),
        "branch": branch,
        "home": home,
        "away": away,
        "homeScore": scores[0] if len(scores) >= 2 else None,
        "awayScore": scores[1] if len(scores) >= 2 else None,
        "venue": venue or "TBC",
        "referee": ref or "TBC",
        "conceded": conceded,
        "conceder": conceder,
        "isHome": home == club,
        "opponent": away if home == club else home,
    }


COMP_RE = re.compile(r"/fixtures-results/(?!team/|venue/)")
TEAM_RE = re.compile(r"/team/")
VENUE_RE = re.compile(r"/venue/")


def match_blocks(soup):
    """
    Find each block that holds one match.

    Take the smallest elements carrying two team links, then climb until the
    block also carries its competition link. Climbing matters: the tightest
    wrapper around the two teams usually excludes the competition and venue,
    which sit in sibling elements.
    """
    seed = []
    for el in soup.find_all(True):
        if len(el.find_all("a", href=TEAM_RE)) >= 2:
            seed.append(el)

    ids = {id(e) for e in seed}
    minimal = [el for el in seed
               if not any(id(c) in ids for c in el.find_all(True))]

    blocks, seen = [], set()
    for el in minimal:
        node = el
        for _ in range(4):
            if node.find("a", href=COMP_RE):
                break
            if node.parent is None:
                break
            node = node.parent
        if id(node) not in seen:
            seen.add(id(node))
            blocks.append(node)
    return blocks


def nearest_date(block):
    """Walk back to the date heading this match sits under."""
    for prev in block.find_all_previous(["h1", "h2", "h3", "h4", "h5"]):
        got = heading_date(clean(prev))
        if got:
            return got
    return None


def parse_page(html, club, branch):
    soup = BeautifulSoup(html, "html.parser")
    fixtures, results, seen = [], [], set()
    blocks = match_blocks(soup)
    skipped_nodate = 0

    for block in blocks:
        date = nearest_date(block)
        if not date:
            skipped_nodate += 1
            continue

        m = parse_match(block, date, club, branch)
        if not m or club not in (m["home"], m["away"]):
            continue

        key = (m["date"], m["time"], m["home"], m["away"])
        if key in seen:
            continue
        seen.add(key)

        ht, at = total(m["homeScore"]), total(m["awayScore"])
        played = (ht is not None and at is not None and (ht > 0 or at > 0)) or m["conceded"]

        if m["conceded"] and (ht is None or at is None):
            # Walkover: no score, but it counts. Whoever is marked (C) lost.
            m["homeScore"] = m["awayScore"] = "\u2014"
            m["homeTotal"] = m["awayTotal"] = 0
            m["ourTotal"] = m["theirTotal"] = 0
            m["outcome"] = "L" if m["conceder"] == club else "W"
            m["competition"] += " (walkover)"
            m.pop("conceded", None); m.pop("conceder", None)
            results.append(m)
        elif played and ht is not None and at is not None:
            our, their = (ht, at) if m["isHome"] else (at, ht)
            m["homeTotal"], m["awayTotal"] = ht, at
            m["ourTotal"], m["theirTotal"] = our, their
            m["outcome"] = "W" if our > their else ("L" if our < their else "D")
            m.pop("conceded", None); m.pop("conceder", None)
            results.append(m)
        elif not played:
            for k in ("homeScore", "awayScore", "conceded", "conceder"):
                m.pop(k, None)
            fixtures.append(m)

    print("    blocks %d, ours %d%s" % (
        len(blocks), len(fixtures) + len(results),
        ", %d had no date heading" % skipped_nodate if skipped_nodate else ""))
    return fixtures, results, soup


def parse_tables(soup, club, branch):
    """League tables. Keep only the ones Killeshin appears in."""
    out = []
    for tbl in soup.find_all("table"):
        name = clean(tbl.find_previous(["h3", "h4"]))
        if not name:
            continue
        rows = []
        for tr in tbl.find_all("tr"):
            cells = [clean(td) for td in tr.find_all("td")]
            if len(cells) < 9:
                continue
            nums = [c for c in cells if re.match(r"^-?\d+$", c)]
            team = next((c for c in cells if not re.match(r"^-?\d+$", c)), None)
            if not team or len(nums) < 8:
                continue
            try:
                rows.append({"team": team, "p": int(nums[2]), "w": int(nums[3]),
                             "l": int(nums[4]), "d": int(nums[5]), "f": int(nums[6]),
                             "a": int(nums[7]), "pts": int(nums[-1])})
            except (ValueError, IndexError):
                continue
        if rows and any(r["team"] == club for r in rows):
            out.append({"competition": tidy(name), "grade": grade_of(name),
                        "branch": branch, "rows": rows})
    return out


def merge_news(payload):
    """news.py writes news.json separately; fold it in so the phone fetches once."""
    try:
        with open(os.path.join(HERE, "news.json"), encoding="utf-8") as fh:
            blob = json.load(fh)
    except (OSError, ValueError):
        print("  news:    none yet (run news.py)")
        return payload
    payload["news"] = blob.get("news", [])
    payload["newsSources"] = blob.get("sources", [])
    free = sum(1 for n in payload["news"] if n.get("access") != "subscriber")
    print("  news:    %d (free %d, subscriber %d)"
          % (len(payload["news"]), free, len(payload["news"]) - free))
    return payload


def main():
    fixtures, results, tables, failed = [], [], [], []

    for branch, cfg in BRANCHES.items():
        print("%s \u2014 %s" % (cfg["name"], cfg["source"].split("/")[2]))
        r = fetch(cfg["source"])
        if r is None:
            failed.append(branch)
            continue

        fx, rs, soup = parse_page(r.text, cfg["team"], branch)
        tb = parse_tables(soup, cfg["team"], branch)
        print("  fixtures %d, results %d, tables %d" % (len(fx), len(rs), len(tb)))
        if not fx and not rs:
            failed.append(branch)
        fixtures += fx
        results += rs
        tables += tb

    if failed:
        # One board being down must not wipe the other. Carry the failed
        # branch's last-known data forward and keep going.
        try:
            with open(OUT, encoding="utf-8") as fh:
                prev = json.load(fh)
        except (OSError, ValueError):
            prev = None

        if prev is None:
            print("\nNo data for %s and no previous file to fall back on."
                  % ", ".join(failed), file=sys.stderr)
            sys.exit(1)

        for b in failed:
            kept = 0
            for key, bucket in (("fixtures", fixtures), ("results", results), ("tables", tables)):
                old_items = [x for x in prev.get(key, []) if x.get("branch") == b]
                bucket += old_items
                kept += len(old_items)
            print("  %s: kept %d previous entries" % (b, kept))

        if len(failed) == len(BRANCHES):
            print("\nBoth boards unreachable. Nothing new written.", file=sys.stderr)
            sys.exit(1)
        print("\nWarning: %s could not be reached this run." % ", ".join(failed))

    fixtures.sort(key=lambda x: (x["date"], x["time"]))
    results.sort(key=lambda x: (x["date"], x["time"]), reverse=True)

    items = fixtures + results + tables
    grades_by = {b: [g for g in GRADE_ORDER
                     if any(m["grade"] == g for m in items if m["branch"] == b)]
                 for b in BRANCHES}

    payload = {
        "club": "Killeshin GAA",
        "county": "Laois",
        "ground": GROUND,
        "branches": BRANCHES,
        "gradesBy": grades_by,
        "source": BRANCHES["men"]["source"],
        "updated": datetime.now(timezone(timedelta(hours=1))).isoformat(timespec="seconds"),
        "fixtures": fixtures,
        "results": results,
        "tables": tables,
    }
    payload = merge_news(payload)

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    print("Wrote", OUT)

    print("Calendar feeds:")
    subprocess.run([sys.executable, os.path.join(HERE, "make_ics.py")], check=True)


if __name__ == "__main__":
    main()

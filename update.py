#!/usr/bin/env python3
"""
Killeshin GAA — the whole update in one script.

Reads both county boards, gathers local news, and writes the result straight
into index.html. The app carries its own data, so there is no second file to
fall out of step with it.

    pip install requests beautifulsoup4
    python update.py

Nothing is written unless at least one county board is read successfully.
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from xml.etree import ElementTree as ET

import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "index.html")

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IE,en;q=0.9",
}
TRIES, TIMEOUT = 3, 60

BRANCHES = {
    "men": {
        "name": "Men", "team": "Gleann Uiseann", "crest": "crest.png",
        "source": ("https://laoisgaa.ie/fixtures-results/team/gleann-uiseann/"
                   "6547884c-ea64-5502-8472-8eb26b092437/"),
    },
    "ladies": {
        "name": "Ladies", "team": "Killeshin", "crest": "crest-ladies.png",
        "source": ("https://laoislgfa.ie/fixtures-results/team/killeshin/"
                   "6063df22-0a35-9537-87e6-5276dfa17357/"),
    },
}

GROUND = "Seamus Hearns Park"

# Opposition crests.
#
# The scraper takes them from the county board pages when it can. Anything you
# add below wins over what it finds, so if a club's crest is missing or wrong
# just paste a direct image link here:
#
#     "Ballyfin": "https://example.com/ballyfin-crest.png",
#
# The name must match exactly how the county board writes it. Anything with no
# crest shows the club's initials in a badge instead, which is fine.
CREST_OVERRIDES = {
}

CREST_MAP = {}
CRESTS_FILE = "crests.json"      # kept beside the app so an upload cannot wipe it
FORM_FILE = "form.json"          # last few results for every club we play
RESULTS_FILE = "results.json"    # everything we have ever seen, so nothing is lost
DATA_FILE = "data.json"          # the live data, kept out of index.html
PAGE_TRIES = 6                   # how far back to page through a team's history
TEAM_URLS = {}
SRC_BASE = ["https://laoisgaa.ie/"]

# ---------------------------------------------------------------------------
# Matches called off. The county boards are often slow to mark these, so put
# them here and the app stamps POSTPONED across the fixture within the hour.
#
#   date    - the day it was due to be played, YYYY-MM-DD
#   grade   - Senior, Junior A, U17, U16 ... as shown on the filter chips
#   branch  - "men" or "ladies"
#   note    - optional line shown under the stamp
#
# Delete the entry once a new date is published and it goes back to normal.
# ---------------------------------------------------------------------------
POSTPONED = [
    # {"date": "2026-09-08", "grade": "U16", "branch": "ladies",
    #  "note": "New date to be confirmed"},
]

# ---------------------------------------------------------------------------
# A single strip on the home page for whatever the club is running now.
# Set "show" to False to take it down, or change the wording for the next one.
# ---------------------------------------------------------------------------
PROMO = {
    "show": True,
    "tag": "Last One Standing",
    "title": "Who is still in?",
    "note": "Live tracker of every pick. Entries are closed.",
    "url": ("https://www.oneshotclub.ie/killeshin-gaa/"
            "killeshin-gaa-last-man-standing/selections-tracker"),
}

# The club shop runs as two separate O'Neills pages, so it opens out into
# both rather than taking two rows on the Club tab.
SHOP = {
    "title": "Club shop",
    "note": "Jerseys, training gear and leisurewear from O\u2019Neills",
    "men": "https://www.oneills.com/shop-by-team/gaa/ireland/killeshin-mens.html",
    "ladies": "https://www.oneills.com/shop-by-team/gaa/ireland/killeshin-ladies.html",
}

# ---------------------------------------------------------------------------
# Which games need a ticket.
#
# The boards do not flag this in the fixtures, so it is worked out from the
# usual pattern: adult championship games, and anything at a county ground.
# Correct it here when the rule gets it wrong.
#
#   always / never - "YYYY-MM-DD grade" for one specific game, e.g.
#                    "2026-09-12 Senior"
# ---------------------------------------------------------------------------
TICKETED = {
    # Confirmed ticketed venues: the two county grounds, at any grade.
    "venues": ["o'moore park", "omoore park", "laois hire", "loetb"],
    "always": [],
    "never": [],
}


def needs_ticket(m):
    """
    The board marks ticketed games directly on the fixtures page - see
    hasTicketLink, read at parse time - and that is checked first, ahead of
    this. This is only the fallback for the window before a ticket link has
    gone up.

    Two separate reasons a game is ticketed:
      - a recognised county venue, at any grade and any stage
      - an actual decisive final, at any grade, wherever it is played -
        underage finals are charged for regardless of venue. This has to
        exclude "quarter-final" and "semi-final", since both contain the
        word "final" too and are not the same thing, and it does not
        require the word "championship" - some finals are labelled things
        like "League Knockout Stages - Final" instead.
    """
    tag = "%s %s" % (m["date"], m["grade"])
    if tag in TICKETED["never"]:
        return False
    if tag in TICKETED["always"]:
        return True

    venue = (m.get("venue") or "").lower()
    if any(v in venue for v in TICKETED["venues"]):
        return True

    comp = (m.get("competition") or "").lower()
    return "final" in comp and "quarter" not in comp and "semi" not in comp


# Match tickets are sold by the county boards, one page each.
TICKETS = {
    "title": "Buy match tickets",
    "note": "County board ticket pages for championship and league games",
    "men": "https://laoisgaa.ie/football-match-tickets/?ftredirect=1",
    "ladies": "https://laoislgfa.ie/tickets/",
}

# ---------------------------------------------------------------------------
# Media shown on the Club tab. Add a line here and it appears within the hour.
# kind: video | social | read | about
# ---------------------------------------------------------------------------
MEDIA = [
    # Video: only links that open a match. Channel pages and search results
    # make people hunt, so they are not worth a row.
    {"kind": "video", "title": "Killeshin v Rosenallis",
     "note": "Senior Championship Round 2 \u00b7 7 August 2026 \u00b7 highlights",
     "url": "https://www.youtube.com/watch?v=quXSGaRA0gg"},
    {"kind": "video", "title": "Killeshin v Stradbally",
     "note": "Senior Championship Round 1 \u00b7 22 July 2026 \u00b7 highlights",
     "url": "https://www.youtube.com/watch?v=WIAOJlITbOM"},
    # One link per paper. Each searches that site for "Killeshin GAA",
    # newest first, so it lands on club stories rather than a section front.
    {"kind": "read", "title": "LaoisToday",
     "note": "The fullest Killeshin archive \u00b7 sport is subscriber only",
     "url": "https://www.google.com/search?q=site%3Alaoistoday.ie+%22Killeshin+GAA%22&tbs=sbd%3A1"},
    {"kind": "read", "title": "Leinster Express",
     "note": "Killeshin GAA, newest first \u00b7 free to read",
     "url": "https://www.google.com/search?q=site%3Aleinsterexpress.ie+%22Killeshin+GAA%22&tbs=sbd%3A1"},
    {"kind": "read", "title": "Laois Nationalist",
     "note": "Killeshin GAA, newest first \u00b7 free to read",
     "url": "https://www.google.com/search?q=site%3Alaois-nationalist.ie+%22Killeshin+GAA%22&tbs=sbd%3A1"},
    {"kind": "read", "title": "Carlow Nationalist",
     "note": "Killeshin GAA, newest first \u00b7 free to read",
     "url": "https://www.google.com/search?q=site%3Acarlow-nationalist.ie+%22Killeshin+GAA%22&tbs=sbd%3A1"},
    {"kind": "social", "title": "TikTok",
     "note": "@killeshin.gaa \u00b7 1,900 followers, the busiest club channel",
     "url": "https://www.tiktok.com/@killeshin.gaa"},
    {"kind": "social", "title": "Facebook",
     "note": "2,400 followers \u00b7 club news lands here first",
     "url": "https://www.facebook.com/KilleshinGaa/"},
    {"kind": "social", "title": "Instagram",
     "note": "@killeshingaa",
     "url": "https://www.instagram.com/killeshingaa/"},
    {"kind": "social", "title": "X",
     "note": "@GaaKilleshin \u00b7 quiet since 2018",
     "url": "https://x.com/GaaKilleshin"},
    {"kind": "about", "title": "Killeshin GAA on Wikipedia",
     "note": "Club history, honours and notable years",
     "url": "https://en.wikipedia.org/wiki/Killeshin_GAA"},
]

# A few facts for the About panel. Sourced from Wikipedia and the county board.
CLUB_FACTS = {
    "founded": "1921",
    "ground": "Seamus Hearns Park, also called P\u00e1irc Uise\u00e1n",
    "colours": "Green and white",
    "honours": [
        "Laois Intermediate Championship \u2014 1958, 1974, 1993, 2011",
        "Laois Junior Championship \u2014 1957, 1969, 1981, 2008",
        "First ever Laois Senior Championship final \u2014 2019",
        "Winners of RT\u00c9\u2019s Celebrity Bainisteoir, 2011, managed by Tony Cascarino",
    ],
}


def norm_club(name):
    """Loose key so 'St Joseph's GAA' and 'St Josephs' match."""
    n = re.sub(r"\b(gaa|clg|club|lgfa|ladies)\b", " ", (name or "").lower())
    return re.sub(r"[^a-z0-9]", "", n)


CLUB_DIRECTORIES = [
    "https://laoisgaa.ie/clubs/",
    "https://laoislgfa.ie/clubs/",
]


def meta_image(soup):
    """The crest is published as the page's share image."""
    for attrs in ({"property": "og:image"}, {"name": "twitter:image"}):
        tag = soup.find("meta", attrs=attrs)
        if tag and tag.get("content"):
            src = tag["content"]
            if "laois.png" in src or "/themes/" in src or "lgfa-logo" in src.lower():
                continue                      # county fallback image, not a crest
            return src
    return None


def club_page_index():
    """
    Club name -> its page. Tries the directory, and reports what it actually
    sees so a bad guess shows up in the log rather than failing silently.
    """
    pages, crests = {}, {}
    for base in CLUB_DIRECTORIES:
        host = base.split("/")[2]
        r = fetch(base, quiet=True)
        if r is None:
            print("      %-14s unreachable" % host)
            continue
        soup = BeautifulSoup(r.text, "html.parser")
        links = soup.find_all("a", href=re.compile(r"/clubs/[^/]+/?$"))
        with_img = 0
        for a in links:
            name = clean(a) or a["href"].rstrip("/").split("/")[-1].replace("-", " ")
            name = re.sub(r"\s*\d+$", "", name).strip()
            key = norm_club(name)
            if not key or len(name) > 40:
                continue
            pages.setdefault(key, requests.compat.urljoin(base, a["href"]))
            img = a.find("img")
            if img is not None:
                src = img.get("data-src") or img.get("data-lazy-src") or img.get("src")
                if src and "/themes/" not in src and "laois.png" not in src:
                    crests.setdefault(key, requests.compat.urljoin(base, src))
                    with_img += 1
        print("      %-14s %d club links, %d with a crest on the listing"
              % (host, len(links), with_img))
    return pages, crests


def harvest_crests(wanted, already):
    """
    Two passes. Take crests straight off the directory listing where they are
    there, then open the individual club page for anything still missing and
    read its share image. Only for clubs we actually play.
    """
    missing = [w for w in wanted if norm_club(w) not in already]
    if not missing:
        print("      nothing new to look up")
        return {}

    pages, listing = club_page_index()
    found = {}

    for name in missing:
        key = norm_club(name)
        if key in listing:
            found[key] = listing[key]
    if found:
        print("      %d crests taken from the listing" % len(found))

    still = [n for n in missing if norm_club(n) not in found]
    opened = 0
    for name in still:
        url = pages.get(norm_club(name))
        if not url:
            print("      no club page for %s" % name)
            continue
        r = fetch(url, quiet=True)
        opened += 1
        if r is None:
            continue
        crest = meta_image(BeautifulSoup(r.text, "html.parser"))
        if crest:
            found[norm_club(name)] = crest
    if opened:
        print("      opened %d club pages, %d crests in total" % (opened, len(found)))
    if not found:
        print("      no crests found - the app will show initials instead")
    return found


def comp_kind(name):
    """A championship run and a league campaign are separate stories, so form
    is never mixed across the two. Several competitions are championships
    played in a league format, so the word championship wins."""
    return "championship" if "championship" in (name or "").lower() else "league"


def form_key(name, branch, grade, kind):
    """Form belongs to one team in one competition."""
    return "%s|%s|%s|%s" % (norm_club(name), branch, grade, kind)


def last_three(results):
    """Newest first in, oldest first out - so the app can read left to right."""
    results = sorted(results, key=lambda x: (x["date"], x.get("time", "")), reverse=True)
    return [x["outcome"] for x in results[:3] if x.get("outcome")]


def harvest_form(opponents, branch_of):
    """
    Read each opponent's own team page and keep the last three results for
    every age group, so a Senior fixture shows Senior form.
    """
    out, done = {}, 0
    for name in opponents:
        url = TEAM_URLS.get(norm_club(name))
        if not url:
            continue
        r = fetch(url, quiet=True)
        if r is None:
            continue
        branch = branch_of.get(name, "men")
        try:
            _, res, _ = parse_board(r.text, name, branch)
        except Exception:
            continue
        buckets = {}
        for x in res:
            buckets.setdefault((x["grade"], comp_kind(x["competition"])), []).append(x)
        for (grade, kind), rows in buckets.items():
            f = last_three(rows)
            if f:
                out[form_key(name, branch, grade, kind)] = f
        done += 1
    print("      read %d club pages, %d team records" % (done, len(out)))
    return out


SEEN_FILE = "seen.json"          # tracks what is new or changed, for the badges


def fixture_identity(m):
    """
    A fixture's stable identity - who, at what grade, in which named round.
    Deliberately excludes date, time, venue and referee, because those are
    exactly the things that get confirmed or changed after a fixture first
    appears, and a rescheduled game is still the same fixture, not a new one.
    """
    return "%s|%s|%s|%s" % (m["branch"], m["grade"], norm_club(m["opponent"]), m["competition"])


def fixture_fingerprint(m):
    """The volatile part - if any of this changes, the fixture has been updated."""
    return "%s|%s|%s|%s|%s" % (m.get("date", ""), m.get("time", ""), m.get("venue", ""),
                               m.get("referee", ""), m.get("hasTicketLink", False))


def track_changes(fixtures, results, path):
    """
    Compares this run against what was seen last time, so the app can show a
    NEW flag on anything posted in the last 24 hours and an UPDATED flag on
    any fixture whose date, time, venue or referee has changed since it was
    first seen. The flags are worked out here, once an hour, rather than in
    the browser, so nothing depends on a visitor's clock.
    """
    try:
        with open(path, encoding="utf-8") as fh:
            seen = json.load(fh)
    except (OSError, ValueError):
        seen = {}
    seen_fx = seen.get("fixtures", {})
    seen_rs = seen.get("results", {})

    dub = timezone(timedelta(hours=1))
    now = datetime.now(dub)
    now_iso = now.isoformat()
    cutoff = (now - timedelta(hours=24)).isoformat()

    def within_a_day(iso):
        return iso is not None and iso > cutoff

    new_fx = new_up = 0
    for f in fixtures:
        ident = fixture_identity(f)
        fp = fixture_fingerprint(f)
        prior = seen_fx.get(ident)
        if prior is None:
            seen_fx[ident] = {"firstSeen": now_iso, "fp": fp}
            f["isNew"] = True
            new_fx += 1
        else:
            f["isNew"] = within_a_day(prior.get("firstSeen"))
            if prior.get("fp") != fp:
                prior["fp"] = fp
                prior["changedAt"] = now_iso
                # A fixture just posted for the first time is NEW, not
                # UPDATED - the fingerprint "changing" from nothing does not
                # count as an edit.
                f["isUpdated"] = not f["isNew"]
                new_up += 0 if f["isNew"] else 1
            else:
                f["isUpdated"] = within_a_day(prior.get("changedAt"))
            seen_fx[ident] = prior

    new_rs = 0
    for r in results:
        key = match_key(r)
        prior = seen_rs.get(key)
        if prior is None:
            seen_rs[key] = {"firstSeen": now_iso}
            r["isNew"] = True
            new_rs += 1
        else:
            r["isNew"] = within_a_day(prior.get("firstSeen"))

    # Drop anything that no longer needs remembering, so the file does not
    # grow forever: fixtures once they are off the upcoming list, results
    # once their NEW flag could not possibly still apply.
    live_fx_ids = {fixture_identity(f) for f in fixtures}
    seen_fx = {k: v for k, v in seen_fx.items() if k in live_fx_ids}
    seen_rs = {k: v for k, v in seen_rs.items() if v.get("firstSeen", "") > cutoff}

    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"fixtures": seen_fx, "results": seen_rs}, fh, ensure_ascii=False, separators=(",", ":"))

    print("  new: %d fixtures, %d results   updated: %d fixtures" % (new_fx, new_rs, new_up))
    return fixtures, results


def match_key(m):
    return "%s|%s|%s|%s" % (m["date"], m.get("time", ""), m["home"], m["away"])


def fetch_all_pages(base, club, branch):
    """
    A team page shows only its recent matches. Walk back through the older
    pages so a full season is picked up, not just the last few weeks.
    """
    fixtures, results, soup = [], [], None
    seen = set()
    for page in range(1, PAGE_TRIES + 1):
        url = base if page == 1 else "%s?page=%d" % (base.rstrip("/") + "/", page)
        r = fetch(url, quiet=(page > 1))
        if r is None:
            break
        fx, rs, sp = parse_board(r.text, club, branch)
        if page == 1:
            soup = sp
        fresh = 0
        for m in fx:
            k = match_key(m)
            if k not in seen:
                seen.add(k); fixtures.append(m); fresh += 1
        for m in rs:
            k = match_key(m)
            if k not in seen:
                seen.add(k); results.append(m); fresh += 1
        if page > 1:
            print("      page %d added %d" % (page, fresh))
        if fresh == 0 and page > 1:
            break
    return fixtures, results, soup


def merge_archive(results, path):
    """
    Keep every result we have ever read. The board drops older matches off the
    team page as the season goes on, and without this they vanish from the app
    too.
    """
    old = []
    try:
        with open(path, encoding="utf-8") as fh:
            old = json.load(fh)
    except (OSError, ValueError):
        pass

    by_key = {}
    for m in old:
        by_key[match_key(m)] = m
    added = 0
    for m in results:
        k = match_key(m)
        if k not in by_key:
            added += 1
        by_key[k] = m                      # a fresh read wins over the stored copy

    merged = sorted(by_key.values(), key=lambda x: (x["date"], x.get("time", "")), reverse=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, ensure_ascii=False, separators=(",", ":"))
    print("  archive: %d held, %d new this run" % (len(merged), added))
    return merged


def mark_postponed(fixtures):
    hits = 0
    for f in fixtures:
        for pp in POSTPONED:
            if (f["date"] == pp["date"]
                    and f["grade"] == pp.get("grade", f["grade"])
                    and f["branch"] == pp.get("branch", f["branch"])
                    and pp.get("opponent", f["opponent"]) == f["opponent"]):
                f["postponed"] = True
                f["postponedNote"] = pp.get("note", "")
                hits += 1
    print("  postponed: %d marked" % hits)
    return fixtures


# Club links shown on the Club tab. Edit here; the app picks them up on the
# next run. "mark" is the letter in the circle.
CLUB_LINKS = [
    {"group": "Support the club", "mark": "\u20ac", "title": "Play the club lotto",
     "note": "Pick your numbers online \u2014 Clubforce",
     "url": "https://killeshingaa.clubforce.com/products/lotto/killeshin-gaa"},
    {"group": "Support the club", "mark": "M", "title": "Pay your membership",
     "note": "Sign in to Foireann, then find Killeshin",
     "url": "https://www.foireann.ie/"},
    {"group": "Follow the club", "mark": "L", "title": "Laois GAA",
     "note": "County board \u2014 men's fixtures and results",
     "url": "https://laoisgaa.ie/"},
    {"group": "Follow the club", "mark": "L", "title": "Laois LGFA",
     "note": "County board \u2014 ladies fixtures and results",
     "url": "https://laoislgfa.ie/"},
    {"group": "Club tools", "mark": "P", "title": "Book a pitch",
     "note": "Training and match slots across the grounds",
     "url": "https://www.killeshingaa.ie/bookings.html?ref=KG43077"},
]

# Grades to leave off the filter chips. Go Games have no scores published,
# so a chip for them only ever leads to an empty list.
HIDE_GRADES = ["U12"]

# Adult teams first, then underage by age, with the two that only run for
# part of the year at the end.
GRADE_ORDER = ["Senior", "Intermediate", "Junior A", "Junior C", "U20", "Junior",
               "Adult League", "Minor",
               "U17", "U16", "U15", "U14", "U13", "U12", "F\u00e9ile", "Kelly Cup"]

MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}

TEAM_RE = re.compile(r"/team/")
COMP_RE = re.compile(r"/fixtures-results/(?!team/|venue/)")
SCORE_RE = re.compile(r"^\d+-\d+$")
TIME_RE = re.compile(r"^\d{1,2}:\d{2}$")

# ---------------------------------------------------------------- news
NEWS_SOURCES = [
    {"name": "Leinster Express", "access": "free",
     "feeds": ["https://www.leinsterexpress.ie/rss/", "https://www.leinsterexpress.ie/feed/"],
     "pages": ["https://www.leinsterexpress.ie/sport/gaa"]},
    {"name": "Laois Nationalist", "access": "free",
     "feeds": ["https://www.laois-nationalist.ie/feed/"],
     "pages": ["https://www.laois-nationalist.ie/sport/"]},
    {"name": "Carlow Nationalist", "access": "free",
     "feeds": ["https://www.carlow-nationalist.ie/feed/"],
     "pages": ["https://www.carlow-nationalist.ie/sport/gaa/"]},
    {"name": "Laois GAA", "access": "free",
     "feeds": ["https://laoisgaa.ie/feed/"], "pages": ["https://laoisgaa.ie/news/"]},
    {"name": "Laois LGFA", "access": "free",
     "feeds": ["https://laoislgfa.ie/feed/"], "pages": ["https://laoislgfa.ie/news/"]},
    # Premium sports subscription: treat sport as paid, general news as free.
    {"name": "LaoisToday", "access": "mixed", "paid_when": ["/sport/", "/gaa/"],
     "feeds": ["https://www.laoistoday.ie/tag/killeshin/feed/"],
     "pages": ["https://www.laoistoday.ie/tag/killeshin/"]},
]

KILLESHIN = re.compile(r"killeshin|gleann uiseann|seamus hearns", re.I)
NEWS_TAGS = [("Ladies", r"lgfa|ladies"), ("Schools", r"cumann na mbunscol|national school|schools"),
             ("Club", r"fundrais|lotto|agm|committee|development|grant|sponsor"),
             ("Community", r"community|heritage|parish"), ("GAA", r".")]

# ================================================================ helpers

def fetch(url, quiet=False):
    for attempt in range(1, TRIES + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            if not quiet:
                print("    attempt %d/%d: %s" % (attempt, TRIES, type(e).__name__))
            if attempt < TRIES:
                time.sleep(attempt * 10)
    return None


def clean(node):
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)) if node else ""


def grade_of(comp, branch="men"):
    """
    Which club team a competition belongs to.

    Each adult team plays a championship and a league, and they need to count
    as one team, not two:
        Senior    - Senior Championship + ACFL Division 2
        Junior A  - Junior Championship + ACFL Division 4
        Junior C  - Junior C Championship + ACFL Division 7
    """
    c = (comp or "").lower()
    for n in ("20", "17", "16", "15", "14", "13", "12"):
        if re.search(r"\bu-?%s\b|under[\s-]*%s\b" % (n, n), c):
            return "U" + n
    if "f\u00e9ile" in c or "feile" in c:
        return "F\u00e9ile"
    if "minor" in c:
        return "Minor"
    if branch == "men":
        if "junior c" in c or re.search(r"acfl division 7\b", c):
            return "Junior C"
        if re.search(r"acfl division 4\b", c):
            return "Junior A"
        if "junior" in c:
            return "Junior A"
        if re.search(r"acfl division 2\b", c) or "senior" in c:
            return "Senior"
        if "kelly cup" in c:
            return "Kelly Cup"
    else:
        # Ladies: first team is Intermediate, second is Junior B.
        if re.search(r"division 2\b", c) or "intermediate" in c:
            return "Intermediate"
        if re.search(r"division 4\b", c) or "junior" in c:
            return "Junior"
        if "senior" in c:
            return "Senior"
    if "division" in c or "league" in c or "cup" in c:
        return "Adult League"
    return "Other"


def total(score):
    if not score or not SCORE_RE.match(score.strip()):
        return None
    g, p = score.split("-")
    return int(g) * 3 + int(p)


def tidy(comp):
    comp = re.sub(r"^(LOETB|Laois Shopping Centre|Midlands Park Hotel|Laois Hire)\s+",
                  "", (comp or "").strip())
    return re.sub(r"\s+", " ", comp)


def heading_date(text):
    m = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\s+(\d{4})", text)
    if not m or m.group(2)[:3].title() not in MONTHS:
        return None
    return "%s-%02d-%02d" % (m.group(3), MONTHS[m.group(2)[:3].title()], int(m.group(1)))

# ================================================================ fixtures

def match_blocks(soup):
    """
    Smallest blocks holding two team links, climbed until the competition
    link is inside too. The tight wrapper round the teams usually excludes
    the competition and venue, which sit in sibling elements.
    """
    seed = [el for el in soup.find_all(True) if len(el.find_all("a", href=TEAM_RE)) >= 2]
    ids = {id(e) for e in seed}
    minimal = [el for el in seed if not any(id(c) in ids for c in el.find_all(True))]

    blocks, seen = [], set()
    for el in minimal:
        node = el
        for _ in range(4):
            if node.find("a", href=COMP_RE) or node.parent is None:
                break
            node = node.parent
        if id(node) not in seen:
            seen.add(id(node))
            blocks.append(node)
    return blocks


def parse_match(block, date, club, branch):
    bits = [t.strip() for t in block.stripped_strings if t.strip()]
    teams, comp, venue, ref, conceder = [], None, None, None, None
    crests = CREST_MAP

    for a in block.find_all("a"):
        href, text = a.get("href", ""), clean(a)
        if not text:
            continue
        if "/team/" in href:
            name = re.sub(r"\s*\(C\)\s*$", "", text)
            if name != text:
                conceder = name
            teams.append(name)
            # The board sometimes puts a club crest inside the team link.
            # Take it if it is there; the app falls back to a monogram if not.
            img = a.find("img")
            if img is not None and img.get("src"):
                crests[name] = requests.compat.urljoin(SRC_BASE[0], img["src"])
            if href:
                TEAM_URLS.setdefault(norm_club(name),
                                     requests.compat.urljoin(SRC_BASE[0], href))
        elif "/venue/" in href:
            venue = text
        elif COMP_RE.search(href) and comp is None and len(text) > 8:
            comp = text

    if len(teams) < 2:
        return None

    if not venue:                          # "Venue: TBC" carries no venue link
        m = re.search(r"Venue:\s*([^\n]{2,60})", " ".join(bits))
        venue = m.group(1).strip() if m else "TBC"

    joined = " ".join(bits)
    m = re.search(r"Referee:\s*(.+?)(?:\s*\u00b7|\s*Tickets:|\s{2,}|$)", joined)
    # The board marks a ticketed game with "Tickets: Buy Tickets" right next
    # to the referee line - the same text already being read here. Reading
    # this straight from the board beats guessing from grade and wording,
    # which got Senior right and underage cup finals wrong.
    has_ticket_link = bool(re.search(r"Tickets:", joined, re.I))

    scores = [t for t in bits if SCORE_RE.match(t)]
    times = [t for t in bits if TIME_RE.match(t)]
    home, away = teams[0], teams[1]
    mine = norm_club(club)

    return {"date": date, "time": times[0] if times else "TBC",
            "competition": tidy(comp), "grade": grade_of(comp, branch), "branch": branch,
            "home": home, "away": away,
            "homeScore": scores[0] if len(scores) >= 2 else None,
            "awayScore": scores[1] if len(scores) >= 2 else None,
            "venue": venue, "referee": m.group(1).strip() if m else "TBC",
            "conceded": "CONC" in bits, "conceder": conceder,
            "isHome": norm_club(home) == mine, "hasTicketLink": has_ticket_link,
            "opponent": away if norm_club(home) == mine else home}


def parse_board(html, club, branch):
    soup = BeautifulSoup(html, "html.parser")
    fixtures, results, seen, nodate = [], [], set(), 0

    for block in match_blocks(soup):
        date = None
        for prev in block.find_all_previous(["h1", "h2", "h3", "h4", "h5"]):
            date = heading_date(clean(prev))
            if date:
                break
        if not date:
            nodate += 1
            continue

        m = parse_match(block, date, club, branch)
        # Compare loosely: a club can be "Ballyfin" on one page and
        # "Ballyfin CLG" on another, and an exact match silently drops them.
        if not m:
            continue
        key = norm_club(club)
        if key not in (norm_club(m["home"]), norm_club(m["away"])):
            continue

        key = (m["date"], m["time"], m["home"], m["away"])
        if key in seen:
            continue
        seen.add(key)

        ht, at = total(m["homeScore"]), total(m["awayScore"])
        if m["conceded"] and (ht is None or at is None):
            m.update({"homeScore": "\u2014", "awayScore": "\u2014", "homeTotal": 0,
                      "awayTotal": 0, "ourTotal": 0, "theirTotal": 0,
                      "outcome": "L" if norm_club(m["conceder"] or "") == norm_club(club) else "W",
                      "competition": m["competition"] + " (walkover)"})
            results.append(m)
        elif ht is not None and at is not None and (ht > 0 or at > 0):
            our, their = (ht, at) if m["isHome"] else (at, ht)
            m.update({"homeTotal": ht, "awayTotal": at, "ourTotal": our, "theirTotal": their,
                      "outcome": "W" if our > their else ("L" if our < their else "D")})
            results.append(m)
        else:
            for k in ("homeScore", "awayScore"):
                m.pop(k, None)
            fixtures.append(m)
        m.pop("conceded", None)
        m.pop("conceder", None)

    print("    blocks %d, Killeshin %d%s" % (
        len(match_blocks(soup)), len(fixtures) + len(results),
        ", %d without a date heading" % nodate if nodate else ""))
    return fixtures, results, soup


def parse_tables(soup, club, branch):
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
            out.append({"competition": tidy(name), "grade": grade_of(name, branch),
                       "branch": branch, "rows": rows})
    return out

# ================================================================ news

def read_feed(url):
    r = fetch(url, quiet=True)
    if not r:
        return []
    try:
        root = ET.fromstring(r.content)
    except ET.ParseError:
        return []
    out = []
    for it in root.iter("item"):
        t, l = (it.findtext("title") or "").strip(), (it.findtext("link") or "").strip()
        if t and l:
            out.append((t, l, norm_date(it.findtext("pubDate"))))
    if not out:
        ns = "{http://www.w3.org/2005/Atom}"
        for it in root.iter(ns + "entry"):
            t = (it.findtext(ns + "title") or "").strip()
            ln = it.find(ns + "link")
            if t and ln is not None:
                out.append((t, ln.get("href"), norm_date(it.findtext(ns + "updated"))))
    return out


def read_page(url):
    r = fetch(url, quiet=True)
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
        m = re.search(r"/(\d{4})/(\d{2})/(\d{2})/", link)
        out.append((title, link, "%s-%s-%s" % m.groups() if m else None))
    return out


def norm_date(raw):
    if not raw:
        return None
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z",
                "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", raw)
    return m.group(0) if m else None


def gather_news(today):
    stories, seen = [], set()
    for src in NEWS_SOURCES:
        items = []
        for f in src.get("feeds", []):
            items = read_feed(f)
            if items:
                break
        if not items:
            for p in src.get("pages", []):
                items = read_page(p)
                if items:
                    break
        kept = 0
        for title, link, date in items:
            if not KILLESHIN.search(title) and not KILLESHIN.search(link):
                continue
            key = re.sub(r"[^a-z0-9]", "", title.lower())[:70]
            if key in seen:
                continue
            seen.add(key)
            access = src["access"]
            if access == "mixed":
                access = ("subscriber" if any(h in link.lower() for h in src["paid_when"])
                          else "free")
            tag = next(n for n, pat in NEWS_TAGS if re.search(pat, title, re.I))
            stories.append({"date": date or today, "title": title, "source": src["name"],
                           "tag": tag, "access": access, "url": link})
            kept += 1
        print("    %-19s %d" % (src["name"], kept))
    stories.sort(key=lambda s: (s["date"], s["access"] == "free"), reverse=True)
    return stories[:30]

# ================================================================ calendars

def slug(text):
    """A safe filename fragment - "Junior A" becomes "junior-a"."""
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-") or "x"


def write_calendars(fixtures, today):
    feeds = {"all": ("All fixtures", lambda m: True),
             "men": ("Men's", lambda m: m["branch"] == "men"),
             "ladies": ("Ladies", lambda m: m["branch"] == "ladies"),
             "home": ("Home games", lambda m: "Killeshin" in m["venue"])}

    # One feed per team as well, so someone who only wants their own child's
    # games can subscribe to just that, rather than every fixture the club
    # has. This is what the "My teams" filter in the app can point people at.
    team_feed = {}
    for b, g in sorted({(m["branch"], m["grade"]) for m in fixtures}):
        key = "%s-%s" % (b, slug(g))
        label = "%s %s" % ("Ladies" if b == "ladies" else "Men's", g)
        feeds[key] = (label, (lambda bb=b, gg=g: lambda m: m["branch"] == bb and m["grade"] == gg)())
        team_feed[b + "|" + g] = key

    upcoming = sorted([f for f in fixtures if f["date"] >= today and not f.get("postponed")],
                      key=lambda x: (x["date"], x["time"]))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    def esc(t):
        return re.sub(r"([,;\\])", r"\\\1", str(t or "")).replace("\n", "\\n")

    def fold(line):
        out = []
        while len(line.encode()) > 73:
            cut = 73
            while len(line[:cut].encode()) > 73:
                cut -= 1
            out.append(line[:cut])
            line = " " + line[cut:]
        out.append(line)
        return out

    for key, (label, keep) in feeds.items():
        sel = [m for m in upcoming if keep(m)]
        L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Killeshin GAA//EN",
             "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             "X-WR-CALNAME:Killeshin GAA \u2014 " + label,
             "X-WR-TIMEZONE:Europe/Dublin", "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
             "X-PUBLISHED-TTL:PT6H"]
        for i, m in enumerate(sel):
            day = m["date"].replace("-", "")
            timed = bool(TIME_RE.match(m["time"]))
            who = ("Killeshin v " + m["opponent"]) if m["isHome"] else (m["opponent"] + " v Killeshin")
            L += ["BEGIN:VEVENT",
                  "UID:killeshin-%s-%s-%d@killeshingaa" % (m["branch"], m["date"], i),
                  "DTSTAMP:" + stamp]
            if timed:
                hh, mm = (int(x) for x in m["time"].split(":"))
                end = hh * 60 + mm + 90
                L += ["DTSTART;TZID=Europe/Dublin:%sT%02d%02d00" % (day, hh, mm),
                      "DTEND;TZID=Europe/Dublin:%sT%02d%02d00" % (day, (end // 60) % 24, end % 60)]
            else:
                L += ["DTSTART;VALUE=DATE:" + day]
            L += fold("SUMMARY:%s (%s %s)%s" % (
                esc(who), "Ladies" if m["branch"] == "ladies" else "Men's",
                esc(m["grade"]), "" if timed else " \u2014 time TBC"))
            L += fold("LOCATION:" + esc(m["venue"]))
            if m.get("referee") and m["referee"] != "TBC":
                L += fold("DESCRIPTION:" + esc(m["competition"] + " \u00b7 Referee: " + m["referee"]))
            else:
                L += fold("DESCRIPTION:" + esc(m["competition"]))
            if timed:
                L += ["BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY",
                      "DESCRIPTION:" + esc(who), "END:VALARM"]
            L.append("END:VEVENT")
        L.append("END:VCALENDAR")

        with open(os.path.join(HERE, "killeshin-%s.ics" % key), "w", encoding="utf-8") as fh:
            fh.write("\r\n".join(L) + "\r\n")
        if key in ("all", "men", "ladies", "home"):
            print("    killeshin-%-6s %2d events" % (key + ".ics", len(sel)))
    print("    %d team feeds" % len(team_feed))
    return team_feed


def scrape_lms_count(url):
    """
    The public selections tracker for Last One Standing shows a plain line
    right at the top of the page - "N alive of M \u00b7 Gameweek X" - with no
    login needed, at least when read with a browser. Read it the same way
    every other page in this file is read.

    Returns (result, reason). result is None if it could not be read; reason
    explains why, in enough detail to actually diagnose it from the run log
    rather than guessing - in particular, whether the page came back empty of
    the word "alive" at all, which would mean the number is filled in by the
    page's own JavaScript after it loads rather than sitting in the page as
    plain text, and a script like this one can only ever see the plain text.
    """
    r = fetch(url, quiet=True)
    if r is None:
        return None, "the page could not be reached (network error or it refused the request)"

    text = BeautifulSoup(r.text, "html.parser").get_text(" ", strip=True)
    if "alive" not in text.lower():
        snippet = text[:160].replace("\n", " ")
        return None, ("the word \"alive\" never appears in the page as plain text - "
                       "most likely the count is filled in by the page's own script after "
                       "it loads, which this cannot see. First 160 characters read: "
                       + repr(snippet))

    m = re.search(r"(\d[\d,]*)\s+alive of\s+(\d[\d,]*)\D{0,20}Gameweek\s*(\d+)", text, re.I)
    if not m:
        i = text.lower().index("alive")
        return None, ("\"alive\" is there but not in the expected wording. Text around it: "
                       + repr(text[max(0, i - 40):i + 60]))

    return {
        "alive": int(m.group(1).replace(",", "")),
        "total": int(m.group(2).replace(",", "")),
        "gameweek": int(m.group(3)),
    }, "ok"


def write_app(payload):
    """Drop the data straight into index.html's seed script, and stamp the footer."""
    with open(APP, encoding="utf-8") as fh:
        html = fh.read()

    blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = re.sub(
        r'(<script id="seed" type="application/json">)(.*?)(</script>)',
        lambda mm: mm.group(1) + blob + mm.group(3), html, count=1, flags=re.S)

    stamp = datetime.now(timezone(timedelta(hours=1))).strftime("%Y-%m-%d %H:%M")
    html = re.sub(r"Build \d{4}-\d{2}-\d{2} \d{2}:\d{2}", "Build " + stamp, html, count=1)

    with open(APP, "w", encoding="utf-8") as fh:
        fh.write(html)
    print("  wrote %s (%d bytes)" % (os.path.basename(APP), len(html)))


def main():
    fixtures, results, tables = [], [], []
    branch_of = {}
    failed = []

    for branch, cfg in BRANCHES.items():
        print("%s \u2014 %s" % (cfg["name"], cfg["source"].split("/")[2]))
        SRC_BASE[0] = "https://" + cfg["source"].split("/")[2] + "/"
        fx, rs, soup = fetch_all_pages(cfg["source"], cfg["team"], branch)
        if soup is None:
            failed.append(branch)
            continue
        tb = parse_tables(soup, cfg["team"], branch)
        print("    fixtures %d, results %d, tables %d" % (len(fx), len(rs), len(tb)))
        for m in fx + rs:
            branch_of[m["opponent"]] = branch
        fixtures += fx
        results += rs
        tables += tb

    if not fixtures and not results:
        print("Both boards unreachable \u2014 leaving everything as it was.")
        sys.exit(1)

    today = datetime.now(timezone(timedelta(hours=1))).strftime("%Y-%m-%d")

    print("Club crests")
    opponents = sorted({m["opponent"] for m in fixtures + results if m.get("opponent")})
    have = {norm_club(k): v for k, v in CREST_OVERRIDES.items()}
    try:
        with open(os.path.join(HERE, CRESTS_FILE), encoding="utf-8") as fh:
            have.update({norm_club(k): v for k, v in json.load(fh).items()})
    except (OSError, ValueError):
        pass
    print("    %d opponents, %d crests on file" % (len(opponents), len(have)))
    CREST_MAP.update(have)
    CREST_MAP.update(harvest_crests(opponents, have))
    CREST_MAP.update({k: v for k, v in CREST_OVERRIDES.items()})
    if CREST_MAP:
        with open(os.path.join(HERE, CRESTS_FILE), "w", encoding="utf-8") as fh:
            json.dump(CREST_MAP, fh, ensure_ascii=False, indent=1, sort_keys=True)
        print("    %d crests saved to %s" % (len(CREST_MAP), CRESTS_FILE))

    print("Recent form")
    fstore = os.path.join(HERE, FORM_FILE)
    form = {}
    try:
        with open(fstore, encoding="utf-8") as fh:
            form = json.load(fh)
    except (OSError, ValueError):
        pass
    form.update(harvest_form(opponents, branch_of))
    for b, cfg in BRANCHES.items():
        buckets = {}
        for x in results:
            if x["branch"] == b:
                buckets.setdefault((x["grade"], comp_kind(x["competition"])), []).append(x)
        for (grade, kind), rows in buckets.items():
            f = last_three(rows)
            if f:
                form[form_key(cfg["team"], b, grade, kind)] = f
    if form:
        with open(fstore, "w", encoding="utf-8") as fh:
            json.dump(form, fh, ensure_ascii=False, separators=(",", ":"))
        print("    %d clubs saved to %s" % (len(form), FORM_FILE))

    print("News")
    news = gather_news(today)

    results = merge_archive(results, os.path.join(HERE, RESULTS_FILE))
    fixtures, results = track_changes(fixtures, results, os.path.join(HERE, SEEN_FILE))
    fixtures = mark_postponed(fixtures)

    tickets = 0
    for f in fixtures:
        if f.pop("hasTicketLink", False) or needs_ticket(f):
            f["ticket"] = TICKETS["ladies" if f["branch"] == "ladies" else "men"]
            tickets += 1
    print("  ticketed: %d of %d upcoming games" % (tickets, len(fixtures)))

    print("Last One Standing")
    if PROMO.get("show") and PROMO.get("url"):
        lms, reason = scrape_lms_count(PROMO["url"])
        if lms:
            PROMO["note"] = "%d of %d still in \u00b7 Gameweek %d" % (
                lms["alive"], lms["total"], lms["gameweek"])
            print("    %d of %d still in, gameweek %d" % (lms["alive"], lms["total"], lms["gameweek"]))
        else:
            print("    could not read the live count: " + reason)

    print("Calendars")
    team_feeds = write_calendars(fixtures, today)

    gradesBy = {b: [g for g in GRADE_ORDER if g not in HIDE_GRADES
                    and any(m["grade"] == g for m in fixtures + results + tables if m.get("branch") == b)]
                for b in BRANCHES}

    payload = {
        "club": {"links": CLUB_LINKS, "media": MEDIA, "facts": CLUB_FACTS, "shop": SHOP,
                 "tickets": TICKETS},
        "county": "Laois", "ground": GROUND,
        "branches": {b: {"name": cfg["name"], "team": cfg["team"], "crest": cfg["crest"],
                        "source": cfg["source"]} for b, cfg in BRANCHES.items()},
        "gradesBy": gradesBy,
        "source": BRANCHES["men"]["source"],
        "updated": datetime.now(timezone(timedelta(hours=1))).isoformat(),
        "fixtures": fixtures, "results": results, "tables": tables, "news": news,
        "crests": CREST_MAP, "form": form, "promo": PROMO,
        "teamFeeds": team_feeds,
    }

    with open(os.path.join(HERE, DATA_FILE), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    print("Wrote %s (%d fixtures, %d results)" % (DATA_FILE, len(fixtures), len(results)))

    write_app(payload)


if __name__ == "__main__":
    main()
    try:
        import archive
        archive.run()
    except Exception as e:
        print("Season archive skipped:", e)

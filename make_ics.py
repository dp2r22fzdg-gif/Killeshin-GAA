#!/usr/bin/env python3
"""
Build the calendar feeds people subscribe to for match alerts.

Four feeds so nobody gets fixtures they don't care about. Each event carries a
two-hour alarm, so the phone does the reminding — no push server needed, and it
keeps working whether or not the app is open.
"""
import json, os, re
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))

FEEDS = {
    "all":    ("Killeshin GAA \u2014 All fixtures", lambda m: True),
    "men":    ("Killeshin GAA \u2014 Men's",        lambda m: m.get("branch") == "men"),
    "ladies": ("Killeshin GAA \u2014 Ladies",       lambda m: m.get("branch") == "ladies"),
    "home":   ("Killeshin GAA \u2014 Home games",   lambda m: "Killeshin" in (m.get("venue") or "")),
}
ALARM_MINS = 120


def esc(t):
    return re.sub(r"([,;\\])", r"\\\1", str(t or "")).replace("\n", "\\n")


def fold(line):
    """iCalendar lines wrap at 75 octets; some clients are strict about it."""
    out, cur = [], line
    while len(cur.encode()) > 73:
        cut = 73
        while len(cur[:cut].encode()) > 73:
            cut -= 1
        out.append(cur[:cut])
        cur = " " + cur[cut:]
    out.append(cur)
    return out


def build(name, matches, branches):
    L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Killeshin GAA//Fixtures//EN",
         "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
         "X-WR-CALNAME:" + esc(name), "X-WR-TIMEZONE:Europe/Dublin",
         "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    for i, m in enumerate(matches):
        day = m["date"].replace("-", "")
        timed = bool(re.match(r"^\d{1,2}:\d{2}$", m.get("time", "")))
        who = "Killeshin v " + m["opponent"] if m.get("isHome") else m["opponent"] + " v Killeshin"
        tag = "Ladies" if m.get("branch") == "ladies" else "Men's"

        L += ["BEGIN:VEVENT",
              "UID:killeshin-%s-%s-%d@killeshingaa" % (m.get("branch", "x"), m["date"], i),
              "DTSTAMP:" + stamp]
        if timed:
            hh, mm = (int(x) for x in m["time"].split(":"))
            mins = hh * 60 + mm + 90
            L += ["DTSTART;TZID=Europe/Dublin:%sT%02d%02d00" % (day, hh, mm),
                  "DTEND;TZID=Europe/Dublin:%sT%02d%02d00" % (day, (mins // 60) % 24, mins % 60)]
        else:
            L += ["DTSTART;VALUE=DATE:" + day]
        L += fold("SUMMARY:%s (%s %s)%s" % (esc(who), tag, esc(m.get("grade", "")),
                                            "" if timed else " \u2014 time TBC"))
        L += fold("LOCATION:" + esc(m.get("venue", "TBC")))
        L += fold("DESCRIPTION:" + esc(m.get("competition", "")) +
                  ("" if not m.get("referee") or m["referee"] == "TBC"
                   else ". Referee: " + esc(m["referee"])) +
                  ". Source: " + esc(branches.get(m.get("branch"), {}).get("source", "")))
        if timed:
            L += ["BEGIN:VALARM", "TRIGGER:-PT%dM" % ALARM_MINS, "ACTION:DISPLAY",
                  "DESCRIPTION:" + esc(who) + " today", "END:VALARM"]
        L.append("END:VEVENT")

    L.append("END:VCALENDAR")
    return "\r\n".join(L) + "\r\n"


def main():
    with open(os.path.join(HERE, "killeshin.json"), encoding="utf-8") as fh:
        data = json.load(fh)

    today = datetime.now().strftime("%Y-%m-%d")
    upcoming = [f for f in data.get("fixtures", []) if f["date"] >= today]
    upcoming.sort(key=lambda x: (x["date"], x.get("time", "")))
    branches = data.get("branches", {})

    for key, (name, keep) in FEEDS.items():
        sel = [m for m in upcoming if keep(m)]
        path = os.path.join(HERE, "killeshin-%s.ics" % key)
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(build(name, sel, branches))
        print("  killeshin-%-7s %2d events" % (key + ".ics", len(sel)))


if __name__ == "__main__":
    main()

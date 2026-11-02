"""Draw one scenario run's heartbeat as an SVG for the article.

    python3 scripts/timeline-svg.py results/s1-3-....json out.svg

Each 100 ms tick is one mark at the time it started: green when the INSERT was acknowledged,
red when it failed. An acknowledged write that took longer than 250 ms gets a line out to the
moment it was acknowledged, so a client that holds a write instead of failing it is visible too.
"""
import json
import re
import sys
from html import escape

dump = json.load(open(sys.argv[1]))
out = sys.argv[2]
t0 = dump["triggeredAt"]

X_FROM, X_TO = 9.0, 20.0          # seconds after the trigger
LEFT, RIGHT, TOP = 96, 128, 92
LANE_H, LANE_GAP = 34, 22
WIDTH = 920
PLOT_W = WIDTH - LEFT - RIGHT
MODES = ["naive", "tuned", "proxy"]
HEIGHT = TOP + len(MODES) * (LANE_H + LANE_GAP) + 58


def x(seconds):
    return LEFT + (seconds - X_FROM) / (X_TO - X_FROM) * PLOT_W


def rel(ms):
    return (ms - t0) / 1000


events = [e for e in dump["events"] if e["source"] == "afl-dev" and e["date"] >= t0 - 1000]
start = next(e for e in events if re.search(r"started .*failover|promoting previous primary", e["message"], re.I))
done = [e for e in events if re.search(r"completed .*failover", e["message"], re.I)][-1]

parts = []
add = parts.append

add(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" width="{WIDTH}" height="{HEIGHT}" '
    'font-family="Helvetica, Arial, sans-serif" style="color-scheme: light dark">')
add("""<style>
  .bg { fill: light-dark(#fcfcfb, #1a1a19); }
  .ink { fill: light-dark(#0b0b0b, #f0efec); }
  .muted { fill: light-dark(#52514e, #c3c2b7); }
  .grid { stroke: light-dark(#e1e0d9, #2c2c2a); stroke-width: 1; }
  .axis { stroke: light-dark(#c3c2b7, #383835); stroke-width: 1; }
  .event { stroke: light-dark(#52514e, #c3c2b7); stroke-width: 1.5; stroke-dasharray: 4 4; }
  .ok { fill: #0ca30c; }
  .err { fill: #d03b3b; }
  .hold { stroke: #0ca30c; stroke-width: 2; }
  .lane { fill: light-dark(#f3f2ee, #222220); }
</style>""")
add(f'<rect class="bg" width="{WIDTH}" height="{HEIGHT}"/>')

# Legend, top left.
add(f'<rect class="ok" x="{LEFT}" y="22" width="5" height="14" rx="1"/>')
add(f'<text class="ink" x="{LEFT + 12}" y="34" font-size="13">write acknowledged</text>')
add(f'<rect class="err" x="{LEFT + 150}" y="22" width="5" height="14" rx="1"/>')
add(f'<text class="ink" x="{LEFT + 162}" y="34" font-size="13">write failed</text>')
add(f'<line class="hold" x1="{LEFT + 268}" y1="29" x2="{LEFT + 296}" y2="29"/>')
add(f'<text class="ink" x="{LEFT + 304}" y="34" font-size="13">held, then acknowledged</text>')
add(f'<text class="muted" x="{LEFT}" y="58" font-size="12">One INSERT every 100 ms per client, no retries. Downtime is the longest gap between two acknowledged writes.</text>')

# Gridlines every second, labels every two.
plot_bottom = TOP + len(MODES) * (LANE_H + LANE_GAP) - LANE_GAP
for s in range(int(X_FROM), int(X_TO) + 1):
    add(f'<line class="grid" x1="{x(s):.1f}" y1="{TOP - 6}" x2="{x(s):.1f}" y2="{plot_bottom}"/>')
    if s % 2 == 0:
        add(f'<text class="muted" x="{x(s):.1f}" y="{plot_bottom + 20}" font-size="12" text-anchor="middle">{s} s</text>')
add(f'<line class="axis" x1="{LEFT}" y1="{plot_bottom}" x2="{WIDTH - RIGHT}" y2="{plot_bottom}"/>')
add(f'<text class="muted" x="{LEFT + PLOT_W / 2:.0f}" y="{plot_bottom + 42}" font-size="12" text-anchor="middle">seconds after the failover was requested</text>')

downtime = {}
for i, mode in enumerate(MODES):
    y = TOP + i * (LANE_H + LANE_GAP)
    add(f'<rect class="lane" x="{LEFT}" y="{y}" width="{PLOT_W}" height="{LANE_H}" rx="4"/>')
    add(f'<text class="ink" x="{LEFT - 12}" y="{y + LANE_H / 2 + 5}" font-size="14" font-weight="bold" text-anchor="end">{mode}</text>')
    own = sorted((s for s in dump["samples"] if s["mode"] == mode), key=lambda s: s["startedAt"])
    settled = sorted(s["settledAt"] for s in own if s["outcome"] == "ok")
    downtime[mode] = max(b - a for a, b in zip(settled, settled[1:]))
    for s in own:
        start_s = rel(s["startedAt"])
        if not (X_FROM <= start_s <= X_TO):
            continue
        cls = "ok" if s["outcome"] == "ok" else "err"
        add(f'<rect class="{cls}" x="{x(start_s) - 1.5:.1f}" y="{y + 6}" width="3" height="{LANE_H - 12}" rx="1"/>')
        latency = s["settledAt"] - s["startedAt"]
        if s["outcome"] == "ok" and latency > 250:
            end_s = min(rel(s["settledAt"]), X_TO)
            add(f'<line class="hold" x1="{x(start_s):.1f}" y1="{y + LANE_H / 2}" x2="{x(end_s):.1f}" y2="{y + LANE_H / 2}" opacity="0.55"/>')

# Aurora's own events, on top of the lanes.
for e, label, anchor, dx in ((start, "Aurora starts the failover", "start", 6), (done, "Aurora reports it complete", "end", -6)):
    ex = x(rel(e["date"]))
    add(f'<line class="event" x1="{ex:.1f}" y1="{TOP - 12}" x2="{ex:.1f}" y2="{plot_bottom}"/>')
    add(f'<text class="ink" x="{ex + dx:.1f}" y="{TOP - 16}" font-size="12" text-anchor="{anchor}">{escape(label)}, {rel(e["date"]):.1f} s</text>')

# Downtime per lane, in the margin to the right of the lane.
for i, mode in enumerate(MODES):
    y = TOP + i * (LANE_H + LANE_GAP)
    add(f'<text class="muted" x="{WIDTH - RIGHT + 12}" y="{y + LANE_H / 2 + 5}" font-size="13">downtime {downtime[mode] / 1000:.1f} s</text>')

add("</svg>")
open(out, "w").write("\n".join(parts) + "\n")
print(out, {m: downtime[m] for m in MODES})

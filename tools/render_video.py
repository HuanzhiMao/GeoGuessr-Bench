#!/usr/bin/env python3
"""Render the GeoGuesser Bench project page's demo videos.

For every episode in assets/data/episodes.json, and every replay in
assets/data/replays.json that is not a plumbing test, this writes

    assets/video/<id>.mp4   1280x720, 30 fps, H.264 (libx264, yuv420p, CRF 22,
                            preset slow, +faststart, BT.709 tags), no audio
    assets/video/<id>.jpg   poster: the held frame with the most clue boxes

then a hero montage of the three illustrative episodes (Precise Localization ->
Place Naming -> Navigation Challenge, at most 95 s, chapters recorded, drawn
with larger type than the per-episode clips so it reads at the page's hero
size) as assets/video/hero.{mp4,jpg}, and the index assets/data/videos.{json,js}
(window.GEOBENCH.videos). The hero's poster is its exact first frame (the
white ground every clip fades in from), so autoplay starts without a jump.
A full run also deletes stale <id>.mp4/.jpg files that videos.json no longer
lists. Container metadata is checked after encoding: only ffmpeg's standard
tags, no file path, user name or episode id.

Everything drawn comes from the episode data: frames, calls, clue boxes, notes,
captions, answers, results and, where the data has them, camera poses. Nothing
is reconstructed: a call without a logged result (other than the camera, move
and capture tools, whose results are a view or a movement status) shows none.
Each video carries a footer with its provenance ("Illustrative",
"Environment walkthrough: renders from the offline environment" or
"Replay: <model>, <run>") and "Imagery: Google Street View". The illustrative
episodes' title cards show no step budget. The illustrative episodes are the
paper's Figure 1, but, as on the page, no drawn text cites a part of the paper: a drawn string matching CITATION_RE ("Figure 1", "Table 3",
"of the paper", ...) stops the encode before the output file is replaced.
Text is wrapped, then shrunk, and every string is asserted to lie inside its
box and inside the 40 px safe area; a violation, or a console header chip with
no room, stops the render.

Layouts
    1:1  frame panel 720x720 on the left, light console 560 px on the right
         (larger type in the hero).
    16:9 full-bleed frame, frosted console on the right third, the current
         call as a toast near the bottom.
    The videos are drawn in the page's light theme: a white ground, ink text, one
    blue accent and pegman yellow for the current step; labels over the photos
    are white pills, Google Maps style.
Sequence per episode
    title card -> per frame: type the step's calls, animate the transition the
    calls imply (pan / tilt / zoom / forward push, chained), print "<- view" /
    "<- moved", update the frame counter (and the heading tape and pose line
    when the data has poses), draw the clue boxes and fade in the notes, hold
    -> end card (answer, map for Precise Localization, replay outcome).

Requirements: Python 3.12, Pillow with FreeType, numpy, the ffmpeg CLI with
libx264 (/opt/homebrew/bin/ffmpeg or on PATH), and, next to this script,
fonts/HankenGrotesk[wght].ttf + GoogleSansCode[wght].ttf (the page's fonts; SIL
OFL 1.1, from github.com/google/fonts) and data/ne_110m_land.geojson (Natural Earth 1:110m
land, public domain). The site is this script's parent folder when it holds
index.html (the page repository's tools/), else ../project_page.

Usage (from the page repository)
    python3 tools/render_video.py               # all clips + hero + videos.{json,js}
    python3 tools/render_video.py --only type2-kenya
    python3 tools/render_video.py --hero-only
Development and QA
    --still ID@T[,T...]   write PNG stills of the uncompressed render (no encode)
    --qa-dir DIR          after encoding, extract stills with ffmpeg at key times
    --report-json FILE    per-video sizes, QA times, container tags and every string
                          drawn (static text and per-frame readouts: counter, pose,
                          heading tape, toasts, map labels)
    --replays FILE --frames-root DIR --out-dir DIR --data-dir DIR | --no-data
    --include-test-replays (render replays marked as plumbing tests; testing only)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

TOOLS = Path(__file__).resolve().parent      # this script's folder, with fonts/ and data/
ROOT = TOOLS.parent
# The site is the parent folder when the script ships inside the page repository (tools/ beside index.html),
# and a project_page/ folder beside this script's folder otherwise.
SITE = ROOT if (ROOT / "index.html").is_file() else ROOT / "project_page"
FONT_DIR = TOOLS / "fonts"
LAND_GEOJSON = TOOLS / "data" / "ne_110m_land.geojson"   # Natural Earth 1:110m land, public domain
FFMPEG = "/opt/homebrew/bin/ffmpeg" if Path("/opt/homebrew/bin/ffmpeg").exists() else (shutil.which("ffmpeg") or "ffmpeg")
FFPROBE = "/opt/homebrew/bin/ffprobe" if Path("/opt/homebrew/bin/ffprobe").exists() else (shutil.which("ffprobe") or "ffprobe")

W, H, FPS = 1280, 720, 30
SAFE = 40
SAFE_BOX = (SAFE, SAFE, W - SAFE, H - SAFE)
CLIP_CAP = 6_000_000          # bytes, per episode clip
HERO_CAP = 12_000_000         # bytes, hero montage
HERO_MAX_S = 95.0
DEFAULT_CRF = 22
FIXED_IDS = ("type1-tepoztlan", "type2-kenya", "type3-flag", "env-walkthrough")
HERO_ORDER = FIXED_IDS[:3]    # the Figure 1 episodes; the walkthrough has its own clip
ATTRIBUTION = "Imagery: Google Street View"
EPS_W = 1e-4                  # backdrop weight floor in the viewport blend
# The only container tags an encode may carry (ffmpeg's defaults; the input is raw video from a pipe).
ALLOWED_TAGS = {"format": {"major_brand", "minor_version", "compatible_brands", "encoder"},
                "stream": {"language", "handler_name", "vendor_id", "encoder"}}

# =============================================================================
# Design tokens (mirrors the page CSS's light theme; the videos are light in both page themes)
# =============================================================================


def _rgb(h: str) -> Tuple[int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


class C:
    # Mirrors the page's light tokens (Google greys, one blue accent); the video ground is --video-bg.
    BG = _rgb("#FFFFFF")            # --video-bg / --surface: the frame ground and the console
    INK = _rgb("#1F1F1F")           # --ink
    MUTED = _rgb("#5F6368")         # --muted
    LINE = _rgb("#DADCE0")          # --line
    HATCH = _rgb("#80868B")         # --hatch: progress segments already shown
    SURFACE = _rgb("#F1F3F4")       # --surface-2
    ACCENT = _rgb("#1967D2")        # fills with white text (Blue 700)
    ACCENT_TEXT = _rgb("#0B57D0")   # --accent (text on the console)
    MARKER = _rgb("#F9AB00")        # --marker (pegman yellow): fills only, it is too light for text on white
    MARKER_TEXT = _rgb("#B06000")   # --marker-edge: the marker's role as text (at least 4.5:1 on white)
    ON_MARKER = _rgb("#202124")     # text on a marker fill
    OVERLAY = _rgb("#FFFFFF")       # pills over the photos (notes, heading tape, toast), Google Maps style
    WHITE = (255, 255, 255)
    GOOD = _rgb("#137333")          # --console-good
    BAD = _rgb("#C5221F")           # --console-bad
    # Task badges carry white text, so each is the 700-900 step of the page's task hue (at least 4.5:1).
    TASK = {"precise_localization": _rgb("#1967D2"), "place_naming": _rgb("#188038"),
            "navigation_challenge": _rgb("#B06000"), None: _rgb("#1967D2")}
    CLUE = {"natural": _rgb("#188038"), "human": _rgb("#D93025")}          # --photo-natural / --photo-human (white halo)
    # Answer map, as the page's map of task locations: grey water, white land, grey coasts
    LAND = _rgb("#FFFFFF")
    WATER = _rgb("#E8EAED")
    COAST = _rgb("#9AA0A6")
    GRID = _rgb("#DADCE0")


def clue_outline(d: "ImageDraw.ImageDraw", xy, col, width: int, kind: str, dash: float = 10, gap: float = 6) -> None:
    """A clue box outline drawn inside xy: solid for natural clues, dashed for human-made ones (as on the page),
    so the two kinds differ by more than hue. Each edge holds whole dashes that start and end at its corners."""
    x0, y0, x1, y1 = [int(v) for v in xy]
    if kind != "human":
        d.rectangle((x0, y0, x1, y1), outline=col, width=width)
        return

    def runs(a: int, b: int):
        length = b - a + 1
        n = max(1, int(round((length + gap) / (dash + gap))))
        period = (length + gap) / n
        on = max(1.0, period - gap)
        for i in range(n):
            s0 = a + i * period
            yield int(round(s0)), min(b, int(round(s0 + on)) - 1)

    for s0, s1 in runs(x0, x1):
        d.rectangle((s0, y0, s1, y0 + width - 1), fill=col)
        d.rectangle((s0, y1 - width + 1, s1, y1), fill=col)
    for s0, s1 in runs(y0, y1):
        d.rectangle((x0, s0, x0 + width - 1, s1), fill=col)
        d.rectangle((x1 - width + 1, s0, x1, s1), fill=col)


def clue_swatch(d: "ImageDraw.ImageDraw", x0: int, y0: int, side: int, kind: str, alpha: float = 1.0) -> None:
    """Legend square: a white tile with the clue colour as its outline, like a box on a photo. A human-made swatch
    breaks each edge once in the middle (corner brackets): the dashed box at swatch size."""
    d.rectangle((x0 - 1, y0 - 1, x0 + side, y0 + side), fill=rgba(C.WHITE, 0.95 * alpha))
    w = max(2, int(round(side / 5)))
    gap = max(2.0, round(side * 0.3))
    clue_outline(d, (x0, y0, x0 + side - 1, y0 + side - 1), rgba(C.CLUE[kind], alpha), w, kind,
                 dash=(side - gap) / 2, gap=gap)


TASK_LABEL = {"precise_localization": "Precise Localization", "place_naming": "Place Naming",
              "navigation_challenge": "Navigation Challenge"}
KIND_TAG = {"illustrative": "Illustrative", "env_tour": "Scripted API test", "replay": "Replay"}
# Console header chip beside the task chip. The walkthrough has none: its task chip reads "Environment walkthrough"
# and the console's first line says it is scripted, not a benchmark episode and not a model rollout.
KIND_TAG_SHORT = {"illustrative": "Illustrative", "replay": "Replay"}
# Wording that cites a part of the paper (the pattern of qa_page.py's CITATION_RE). The page does not cite the paper,
# so no drawn string may: encode() checks every string drawn before it replaces the output file.
CITATION_RE = re.compile(r"\b(Figure|Fig\.|Table|Section|Appendix)\s*\d|of the paper|the paper['’]s", re.I)

# =============================================================================
# Small helpers
# =============================================================================


def clamp01(u: float) -> float:
    return 0.0 if u <= 0 else 1.0 if u >= 1 else u


def ramp(t: float, t0: float, t1: float) -> float:
    if t1 <= t0:
        return 1.0 if t >= t1 else 0.0
    return clamp01((t - t0) / (t1 - t0))


def smooth(u: float) -> float:
    u = clamp01(u)
    return u * u * (3 - 2 * u)


def ease_io(u: float) -> float:
    u = clamp01(u)
    return 4 * u ** 3 if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2


def ease_out(u: float) -> float:
    u = clamp01(u)
    return 1 - (1 - u) ** 3


def shutter(dt: float) -> float:
    """capture_view() flash: peaks at 10% white 0.1 s after the call starts (Gaussian, sigma 0.06 s)."""
    return 0.10 * math.exp(-((dt - 0.1) / 0.06) ** 2)


def lerp(a: float, b: float, u: float) -> float:
    return a + (b - a) * u


def r4(x: float) -> float:
    return round(float(x), 4)


def rgba(c: Sequence[int], a: float = 1.0) -> Tuple[int, int, int, int]:
    return (int(c[0]), int(c[1]), int(c[2]), int(round(255 * clamp01(a))))


def fmt_deg(x: float) -> str:
    v = int(round(x))
    return f"−{abs(v)}" if v < 0 else str(v)


class Overflow(AssertionError):
    """A string does not fit its box or leaves the safe area."""


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)

# =============================================================================
# Fonts and checked text layout
# =============================================================================


_FONT_FILES = {"sans": ("HankenGrotesk[wght].ttf", 100, 900), "mono": ("GoogleSansCode[wght].ttf", 300, 800)}
_fonts: Dict[Tuple[str, int, int], ImageFont.FreeTypeFont] = {}


def font(kind: str, size: float, weight: int = 400) -> ImageFont.FreeTypeFont:
    size = int(round(size))
    key = (kind, size, int(weight))
    f = _fonts.get(key)
    if f is None:
        fn, lo, hi = _FONT_FILES[kind]
        path = FONT_DIR / fn
        if not path.exists():
            raise SystemExit(f"missing font {path}; download it from github.com/google/fonts "
                             "(ofl/hankengrotesk, ofl/googlesanscode)")
        f = ImageFont.truetype(str(path), size)
        f.set_variation_by_axes([max(lo, min(hi, int(weight)))])
        _fonts[key] = f
    return f


def cap_h(f: ImageFont.FreeTypeFont) -> float:
    return -f.getbbox("H", anchor="ls")[1]


def wrap(text: str, f: ImageFont.FreeTypeFont, max_w: float) -> List[str]:
    out: List[str] = []
    for para in text.split("\n"):
        words = para.split()
        if not words:
            out.append("")
            continue
        cur = ""
        for w in words:
            cand = f"{cur} {w}" if cur else w
            if f.getlength(cand) <= max_w:
                cur = cand
                continue
            if cur:
                out.append(cur)
                cur = ""
            while f.getlength(w) > max_w:          # a word longer than the line: break it
                k = len(w) - 1
                while k > 1 and f.getlength(w[:k]) > max_w:
                    k -= 1
                out.append(w[:k])
                w = w[k:]
            cur = w
        out.append(cur)
    return out


@dataclass
class Block:
    font: ImageFont.FreeTypeFont
    lines: List[str]
    size: int
    lh: int

    @property
    def height(self) -> int:
        return self.lh * len(self.lines)


def fit(text: str, kind: str, weight: int, max_w: float, max_lines: int, size: int, min_size: int,
        lh: float = 1.25, what: str = "text", balance: bool = False) -> Block:
    """Wrap, then shrink; raise Overflow if it still does not fit at min_size.

    balance=True narrows the measure as far as the line count allows, so a headline
    does not end in a one-word line.
    """
    for s in range(int(size), int(min_size) - 1, -1):
        f = font(kind, s, weight)
        lines = wrap(text, f, max_w)
        if len(lines) <= max_lines and all(f.getlength(ln) <= max_w + 0.01 for ln in lines):
            if balance and len(lines) > 1:
                lo, hi = max_w * 0.4, max_w
                for _ in range(16):
                    mid = (lo + hi) / 2
                    trial = wrap(text, f, mid)
                    if len(trial) <= len(lines):
                        lines, hi = trial, mid
                    else:
                        lo = mid
            return Block(f, lines, s, int(round(s * lh)))
    raise Overflow(f"{what} does not fit {max_w:.0f}px x {max_lines} lines at >= {min_size}px: {text!r}")


def tracked_w(f: ImageFont.FreeTypeFont, s: str, tr: float) -> float:
    return sum(f.getlength(ch) for ch in s) + tr * max(0, len(s) - 1)


class Canvas:
    """ImageDraw wrapper whose text calls are checked against a box and the safe area.

    (ox, oy) is where this image sits in the 1280x720 frame at rest.
    """

    def __init__(self, im: Image.Image, ox: float = 0, oy: float = 0, safe: bool = True):
        self.im, self.d, self.ox, self.oy, self.safe = im, ImageDraw.Draw(im), ox, oy, safe
        self.strings: List[str] = []

    def check(self, bbox: Tuple[float, float, float, float], box: Optional[Tuple[float, float, float, float]],
              what: str) -> None:
        l, t, r, b = bbox[0] + self.ox, bbox[1] + self.oy, bbox[2] + self.ox, bbox[3] + self.oy
        boxes = ([SAFE_BOX] if self.safe else []) + ([box] if box is not None else [])
        for (x0, y0, x1, y1) in boxes:
            if l < x0 - 0.5 or t < y0 - 0.5 or r > x1 + 0.5 or b > y1 + 0.5:
                raise Overflow(f"{what}: text box ({l:.1f},{t:.1f},{r:.1f},{b:.1f}) leaves "
                               f"({x0},{y0},{x1},{y1})")

    def text(self, xy: Tuple[float, float], s: str, f: ImageFont.FreeTypeFont, fill, anchor: str = "ls",
             box=None, what: str = "text", stroke: int = 0, stroke_fill=None) -> float:
        if s:
            bb = self.d.textbbox(xy, s, font=f, anchor=anchor, stroke_width=stroke)
            self.check(bb, box, f"{what} {s!r}")
            self.d.text(xy, s, font=f, fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=stroke_fill)
            self.strings.append(s)
        return f.getlength(s)

    def tracked(self, x: float, y: float, s: str, f: ImageFont.FreeTypeFont, fill, tr: float, box=None,
                what: str = "label") -> float:
        x0 = x
        for ch in s:
            if ch != " ":
                bb = self.d.textbbox((x, y), ch, font=f, anchor="ls")
                self.check(bb, box, f"{what} {s!r}")
                self.d.text((x, y), ch, font=f, fill=fill, anchor="ls")
            x += f.getlength(ch) + tr
        self.strings.append(s)
        return x - tr - x0

    def lines(self, x: float, y_top: float, blk: Block, fill, box=None, what: str = "text",
              align: str = "left", width: float = 0) -> float:
        """Draw a fitted block; y_top is the top of the first line box. Returns the block height."""
        base = y_top + (blk.lh + cap_h(blk.font)) / 2
        for i, ln in enumerate(blk.lines):
            lx = x + (width - blk.font.getlength(ln)) / 2 if align == "center" else x
            self.text((lx, base + i * blk.lh), ln, blk.font, fill, box=box, what=what)
        return blk.height

    def paste(self, sprite: Image.Image, xy: Tuple[float, float]) -> None:
        self.im.alpha_composite(sprite, (int(round(xy[0])), int(round(xy[1]))))
        self.strings += sprite.info.get("strings", [])     # text drawn inside the sprite (chips)


# =============================================================================
# Sprites (anti-aliased by 4x supersampling)
# =============================================================================


@lru_cache(maxsize=2048)
def rrect(w: int, h: int, r: float, fill: Tuple[int, int, int, int],
          outline: Optional[Tuple[int, int, int, int]] = None, width: float = 0,
          inset_line: Optional[Tuple[int, int, int, int]] = None, ss: int = 4) -> Image.Image:
    w, h = max(1, int(w)), max(1, int(h))
    big = Image.new("RGBA", (w * ss, h * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    d.rounded_rectangle((0, 0, w * ss - 1, h * ss - 1), radius=r * ss, fill=fill,
                        outline=outline, width=int(round(width * ss)) if outline else 0)
    if inset_line is not None:        # road-sign style inner border
        k = 3 * ss
        d.rounded_rectangle((k, k, w * ss - 1 - k, h * ss - 1 - k), radius=max(1, (r - 2.5) * ss),
                            outline=inset_line, width=int(1.5 * ss))
    return big.resize((w, h), Image.LANCZOS)


@lru_cache(maxsize=256)
def dot(r: float, fill: Tuple[int, int, int, int], ring: Tuple[int, int, int, int], ring_w: float,
        ss: int = 4) -> Image.Image:
    R = r + ring_w
    n = int(math.ceil(2 * R + 2))
    big = Image.new("RGBA", (n * ss, n * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    c = n * ss / 2
    d.ellipse((c - R * ss, c - R * ss, c + R * ss, c + R * ss), fill=ring)
    d.ellipse((c - r * ss, c - r * ss, c + r * ss, c + r * ss), fill=fill)
    return big.resize((n, n), Image.LANCZOS)


def chip(text: str, size: int, h: int, pad: float, bg, fg=C.WHITE, weight: int = 800, tr: float = 1.0,
         outline=None, sign: bool = False, r: float = 5) -> Image.Image:
    f = font("sans", size, weight)
    s = text.upper()
    w = int(math.ceil(tracked_w(f, s, tr) + 2 * pad))
    base = rrect(w, h, r, rgba(bg, 1) if bg is not None else (0, 0, 0, 0),
                 outline=rgba(outline, 1) if outline is not None else None, width=1.2 if outline else 0,
                 inset_line=rgba(C.WHITE, 0.9) if sign else None).copy()
    cv = Canvas(base, safe=False)
    y = (h + cap_h(f)) / 2
    cv.tracked(pad, y, s, f, rgba(fg, 1), tr, box=(0, 0, w, h), what="chip")
    base.info["strings"] = cv.strings                      # recorded by Canvas.paste where the chip is drawn
    return base


# =============================================================================
# Map (Natural Earth 1:110m land, data/ne_110m_land.geojson next to this script)
# =============================================================================

_LAND: Optional[List[Tuple[bool, np.ndarray]]] = None


def land_rings() -> List[Tuple[bool, np.ndarray]]:
    global _LAND
    if _LAND is None:
        gj = json.loads(LAND_GEOJSON.read_text())
        rings: List[Tuple[bool, np.ndarray]] = []
        for ft in gj["features"]:
            g = ft["geometry"]
            polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
            for poly in polys:
                for i, ring in enumerate(poly):
                    rings.append((i > 0, np.asarray(ring, dtype=float)[:, :2]))
        _LAND = rings
    return _LAND


def fmt_lat(v: float) -> str:
    return f"{abs(v):g}°{'N' if v > 0 else 'S' if v < 0 else ''}"


def fmt_lng(v: float) -> str:
    v = (v + 180) % 360 - 180
    return f"{abs(v):g}°{'E' if v > 0 else 'W' if v < 0 else ''}"


@dataclass
class MapPoint:
    lat: float
    lng: float
    kind: str           # 'location' | 'truth' | 'guess'
    label: str


def render_map(w: int, h: int, pts: List[MapPoint], min_span: float = 18.0, pad: float = 0.35
               ) -> Tuple[Image.Image, List[Tuple[float, float, MapPoint]], List[str]]:
    """Regional equirectangular map (x scaled by cos(lat0)); returns RGBA, marker pixel positions and the
    graticule labels drawn."""
    lats = [p.lat for p in pts]
    lngs = [p.lng for p in pts]
    lat0 = (min(lats) + max(lats)) / 2
    lng0 = (min(lngs) + max(lngs)) / 2
    cl = max(0.25, math.cos(math.radians(lat0)))
    span = max(min_span, (max(lngs) - min(lngs)) * cl * (1 + 2 * pad),
               (max(lats) - min(lats)) * (1 + 2 * pad) * w / h)
    k = w / span

    def proj(lng: float, lat: float) -> Tuple[float, float]:
        return w / 2 + (lng - lng0) * cl * k, h / 2 - (lat - lat0) * k

    ss = 3
    im = Image.new("RGB", (w * ss, h * ss), C.WATER)
    d = ImageDraw.Draw(im)
    lng_lo, lng_hi = lng0 - w / 2 / (cl * k), lng0 + w / 2 / (cl * k)
    lat_lo, lat_hi = lat0 - h / 2 / k, lat0 + h / 2 / k
    step = next((s for s in (1, 2, 5, 10, 15, 20, 30, 45) if (lng_hi - lng_lo) / s <= 6), 60)
    glines = []
    for gx in range(int(math.floor(lng_lo / step)) * step, int(math.ceil(lng_hi / step)) * step + 1, step):
        x = proj(gx, lat0)[0]
        d.line([(x * ss, 0), (x * ss, h * ss)], fill=C.GRID, width=ss)
        glines.append(("x", x, fmt_lng(gx)))
    for gy in range(int(math.floor(lat_lo / step)) * step, int(math.ceil(lat_hi / step)) * step + 1, step):
        y = proj(lng0, gy)[1]
        d.line([(0, y * ss), (w * ss, y * ss)], fill=C.GRID, width=ss)
        glines.append(("y", y, fmt_lat(gy)))
    for hole, ring in land_rings():
        xs = (w / 2 + (ring[:, 0] - lng0) * cl * k) * ss
        ys = (h / 2 - (ring[:, 1] - lat0) * k) * ss
        if xs.max() < -10 or xs.min() > w * ss + 10 or ys.max() < -10 or ys.min() > h * ss + 10:
            continue
        d.polygon(list(zip(xs.tolist(), ys.tolist())), fill=C.WATER if hole else C.LAND, outline=C.COAST, width=2)
    out = im.resize((w, h), Image.LANCZOS).convert("RGBA")
    cv = Canvas(out, safe=False)
    f = font("mono", 11, 500)
    for axis, v, lab in glines:          # graticule labels along the bottom and left edges
        if axis == "x" and 30 < v < w - 30:
            cv.text((v + 4, h - 7), lab, f, rgba(C.MUTED, 0.9), box=(0, 0, w, h), what="map label")
        if axis == "y" and 18 < v < h - 22:
            cv.text((6, v - 4), lab, f, rgba(C.MUTED, 0.9), box=(0, 0, w, h), what="map label")
    pos = [(proj(p.lng, p.lat)[0], proj(p.lng, p.lat)[1], p) for p in pts]
    for x, y, _ in pos:
        if not (0 <= x <= w and 0 <= y <= h):
            raise Overflow(f"map marker outside the map: {x:.0f},{y:.0f}")
    return out, pos, cv.strings


def round_mask(im: Image.Image, r: int) -> Image.Image:
    m = rrect(im.width, im.height, r, (255, 255, 255, 255)).getchannel("A")
    out = im.copy()
    out.putalpha(Image.fromarray((np.asarray(out.getchannel("A"), np.float32) * np.asarray(m, np.float32) / 255).astype(np.uint8)))
    return out

# =============================================================================
# Tool calls
# =============================================================================


def call_parts(call: str) -> Tuple[str, List[float]]:
    m = re.match(r"\s*([A-Za-z_]\w*)\s*\((.*)\)\s*$", call, re.S)
    if not m:
        return call.strip(), []
    nums = [abs(float(x)) for x in re.findall(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", m.group(2))]
    return m.group(1), nums


def op_kind(name: str) -> str:
    if name in ("scroll_left", "scroll_right"):
        return "pan_h"
    if name in ("scroll_up", "scroll_down"):
        return "pan_v"
    if name in ("zoom_in", "zoom_out"):
        return "zoom"
    if name.startswith("move_"):
        return "move"
    if name == "capture_view":
        return "capture"
    if name == "check_direction":
        return "check"
    return "other"


def result_for(kind: str, given: Optional[str], heading: Optional[float]) -> Tuple[Optional[str], str]:
    """Short result text and style ('ok' | 'error' | 'text'); None when the result is unknown.

    Without a logged result, only what the protocol fixes is shown: camera and capture tools return a view,
    move tools a movement status. Any other call (e.g. a text-returning tool) shows no result; nothing is
    reconstructed.
    """
    if given is not None:                                  # replays log the outcome of every call
        g = given.strip()
        if g == "view":
            return "view", "ok"
        if g == "success":
            return ("moved" if kind == "move" else "success"), "ok"
        if g.lower().startswith("error"):
            return g, "error"
        return g, "text"
    if kind in ("pan_h", "pan_v", "zoom", "capture"):
        return "view", "ok"
    if kind == "move":
        return "moved", "ok"
    return None, "text"

# =============================================================================
# Pacing
# =============================================================================


@dataclass(frozen=True)
class Pace:
    name: str = "full"
    title: float = 2.6
    open: float = 0.8
    first_extra: float = 0.35
    pre_type: float = 0.35
    cps: float = 30.0
    type_min: float = 0.35
    type_gap: float = 0.14
    pre_exec: float = 0.2
    op_gap: float = 0.1
    pan_base: float = 0.75
    pan_per90: float = 0.45
    zoom: float = 1.0
    move: float = 1.05
    capture: float = 0.6
    check: float = 0.5
    other: float = 0.45
    reveal: float = 0.65
    settle: float = 0.15          # gap between a view arriving and its clue boxes / the next prompt
    hold_clues: float = 2.5
    hold_plain: float = 1.6
    close: float = 0.7
    end: float = 4.2
    fade_in: float = 0.3
    fade_out: float = 0.45


FULL = Pace()
# The hero holds each view about twice as long as a quick cut would (an annotated view stays about 3 s), so a
# viewer can read the question, the calls and the clues before the next call starts.
HERO = Pace(name="hero", title=2.2, open=0.55, first_extra=0.15, pre_type=0.2, cps=45.0, type_min=0.25, type_gap=0.08,
            pre_exec=0.12, op_gap=0.06, pan_base=0.65, pan_per90=0.3, zoom=0.8, move=0.9, capture=0.45, check=0.35,
            other=0.35, reveal=0.5, settle=0.15, hold_clues=2.4, hold_plain=1.2, close=0.5, end=3.6, fade_in=0.2,
            fade_out=0.3)
HERO_TOUR = Pace(name="hero-tour", title=1.5, open=0.45, first_extra=0.1, pre_type=0.06, cps=80.0, type_min=0.14,
                 type_gap=0.04, pre_exec=0.05, op_gap=0.03, pan_base=0.38, pan_per90=0.15, zoom=0.45, move=0.5,
                 capture=0.25, check=0.22, other=0.22, reveal=0.3, settle=0.05, hold_clues=1.0, hold_plain=0.3,
                 close=0.4, end=2.4, fade_in=0.2, fade_out=0.3)


def pace_scaled(p: Pace, k: float) -> Pace:
    """Same pace with holds and cards shortened by factor k (used to keep long clips and the hero in budget)."""
    d = dict(p.__dict__)
    for key in ("hold_clues", "hold_plain", "end", "title"):
        d[key] = d[key] * k
    d["hold_plain"] = max(d["hold_plain"], 0.25)
    d["hold_clues"] = max(d["hold_clues"], 0.9)
    d["end"] = max(d["end"], 2.0)
    d["title"] = max(d["title"], 1.3)
    return Pace(**d)

# =============================================================================
# Layouts
# =============================================================================


@dataclass(frozen=True)
class Layout:
    name: str
    vw: int                 # viewport image size (frames are drawn into vw x vh at (0, 0))
    vh: int
    view_x1: int            # right edge of the visible viewport (the console starts here)
    cx0: int                # console panel left edge
    tx0: int                # console text column
    tx1: int
    translucent: bool
    tape_box: Tuple[int, int, int, int]
    tape_cx: float
    notes_y1: int
    toast: bool
    q_size: int
    q_min: int
    log_size: int
    log_lh: int
    note_size: int
    note_lh: int
    chip_size: int
    chip_h: int
    counter_size: int
    pose_size: int
    foot_size: int
    foot_lh: int
    pill_size: int = 20     # clue-note pills on the frame
    pill_h: int = 40
    legend_size: int = 13   # clue-colour legend above the console footer
    end_small: int = 15     # end-card captions

    @property
    def cw(self) -> int:
        return W - self.cx0


SQ = Layout(name="1:1", vw=720, vh=720, view_x1=720, cx0=720, tx0=760, tx1=W - SAFE, translucent=False,
            tape_box=(40, 40, 680, 76), tape_cx=360.0, notes_y1=680, toast=False, q_size=20, q_min=15,
            log_size=16, log_lh=25, note_size=14, note_lh=19, chip_size=12, chip_h=24, counter_size=15,
            pose_size=13, foot_size=13, foot_lh=18)
# The hero plays at about half size in the page (and smaller on phones), so its console, notes and footer
# use roughly 1.6 times the clip sizes.
SQ_HERO = Layout(name="1:1-hero", vw=720, vh=720, view_x1=720, cx0=720, tx0=760, tx1=W - SAFE, translucent=False,
                 tape_box=(40, 40, 680, 76), tape_cx=360.0, notes_y1=680, toast=False, q_size=30, q_min=22,
                 log_size=26, log_lh=38, note_size=21, note_lh=27, chip_size=15, chip_h=30, counter_size=20,
                 pose_size=16, foot_size=17, foot_lh=22, pill_size=31, pill_h=56, legend_size=17, end_small=20)
WIDE = Layout(name="16:9", vw=1280, vh=720, view_x1=853, cx0=853, tx0=877, tx1=W - SAFE, translucent=True,
              tape_box=(40, 40, 813, 76), tape_cx=640.0, notes_y1=626, toast=True, q_size=18, q_min=14,
              log_size=14, log_lh=22, note_size=13, note_lh=18, chip_size=11, chip_h=22, counter_size=14,
              pose_size=12, foot_size=13, foot_lh=17)

# =============================================================================
# Frame images and the viewport compositor
# =============================================================================

M_ID = (1.0, 0.0, 0.0)


def m_comp(m2: Tuple[float, float, float], m1: Tuple[float, float, float]) -> Tuple[float, float, float]:
    """m2 after m1, for transforms screen = c + s (p - c) + o (c = viewport centre)."""
    return (m2[0] * m1[0], m2[0] * m1[1] + m2[1], m2[0] * m1[2] + m2[2])


def m_inv(m: Tuple[float, float, float]) -> Tuple[float, float, float]:
    return (1.0 / m[0], -m[1] / m[0], -m[2] / m[0])


def m_part(op: Tuple[float, float, float], e: float) -> Tuple[float, float, float]:
    return (op[0] ** e, op[1] * e, op[2] * e)


class FrameImg:
    def __init__(self, path: Path, vw: int, vh: int, w: int, h: int):
        im = Image.open(path)
        im.load()
        im = im.convert("RGB")
        if im.size != (w, h):
            raise SystemExit(f"{path}: size {im.size} != declared {(w, h)}")
        self.path, self.src, self.vw, self.vh = path, im, vw, vh
        self.sw, self.sh = im.size
        self.bs = max(vw / self.sw, vh / self.sh)            # cover fit
        self.offx = (vw - self.sw * self.bs) / 2
        self.offy = (vh - self.sh * self.bs) / 2
        self.half = im.resize((max(1, self.sw // 2), max(1, self.sh // 2)), Image.LANCZOS)
        self.view = self.warp(M_ID)
        self.arr = np.asarray(self.view, np.float32)
        bd = self.view.filter(ImageFilter.GaussianBlur(16))
        self.bd = np.asarray(bd, np.float32) * 0.55
        self.md5 = hashlib.md5(path.read_bytes()).hexdigest()

    def warp(self, m: Tuple[float, float, float]) -> Image.Image:
        s, ox, oy = m
        cx, cy = self.vw / 2, self.vh / 2
        src, bs = self.src, self.bs
        if s * bs < 0.6:
            src, bs = self.half, self.bs * self.sw / self.half.width
        a = 1 / (s * bs)
        c = ((-cx - ox) / s + cx - self.offx) / bs
        f = ((-cy - oy) / s + cy - self.offy) / bs
        return src.transform((self.vw, self.vh), Image.AFFINE, (a, 0, c, 0, a, f), resample=Image.BICUBIC)

    def coverage(self, m: Tuple[float, float, float], feather: float = 36.0) -> np.ndarray:
        s, ox, oy = m
        cx, cy = self.vw / 2, self.vh / 2
        x0 = cx + s * (self.offx - cx) + ox
        x1 = cx + s * (self.offx + self.sw * self.bs - cx) + ox
        y0 = cy + s * (self.offy - cy) + oy
        y1 = cy + s * (self.offy + self.sh * self.bs - cy) + oy

        def r1(n: int, a: float, b: float) -> np.ndarray:
            x = np.arange(n, dtype=np.float32) + 0.5
            lo = np.ones(n, np.float32) if a <= 0.5 else np.clip((x - a) / feather, 0, 1)
            hi = np.ones(n, np.float32) if b >= n - 0.5 else np.clip((b - x) / feather, 0, 1)
            return lo * hi
        return np.outer(r1(self.vh, y0, y1), r1(self.vw, x0, x1)).astype(np.float32)

    def box_xy(self, box: Sequence[float]) -> Tuple[float, float, float, float]:
        return (self.offx + box[0] * self.bs, self.offy + box[1] * self.bs,
                self.offx + box[2] * self.bs, self.offy + box[3] * self.bs)

# =============================================================================
# Episode plan: rows (console), steps (frames), transitions
# =============================================================================


@dataclass
class Op:
    call: str
    name: str
    kind: str
    result: Optional[str]
    style: str
    dh: float = 0.0          # heading change (deg)
    dp: float = 0.0          # pitch change (deg)
    zk: float = 1.0          # magnification (FOV ratio), > 1 zooms in
    rdx: float = 0.0         # display shift for the content (px), uncapped
    rdy: float = 0.0
    t0: float = 0.0
    t1: float = 0.0
    failed: bool = False


@dataclass
class VSeg:
    t0: float
    t1: float
    mode: str                 # cross | old | hold | push_out | push_cross | post_in | post | hold_new | bump
    base: Tuple[float, float, float] = M_ID
    op: Tuple[float, float, float] = M_ID
    cinv: Tuple[float, float, float] = M_ID
    curve: Tuple[float, float] = (0.0, 1.0)     # crossfade ramp (in eased op progress)
    flash: bool = False
    settle: bool = False


@dataclass
class Step:
    k: int
    t_type0: float = 0.0
    t_exec0: float = 0.0
    t_arrive: float = 0.0
    t_reveal0: float = 0.0
    t_reveal1: float = 0.0
    t_hold1: float = 0.0
    ops: List[Op] = field(default_factory=list)
    vsegs: List[VSeg] = field(default_factory=list)
    h0: Optional[float] = None
    p0: Optional[float] = None
    f0: Optional[float] = None


@dataclass
class Row:
    kind: str                 # sys | call | note | answer
    t_add: float
    text: str
    gutter: str = ""
    t_type: Tuple[float, float] = (0.0, 0.0)
    t_exec: Tuple[float, float] = (0.0, 0.0)
    result: Optional[str] = None
    style: str = "ok"
    color: Optional[Tuple[int, int, int]] = None
    lines: List[Tuple[str, float, str]] = field(default_factory=list)   # (text, x, font role)
    res_xy: Optional[Tuple[float, int]] = None                           # (x, line index)
    height: int = 0


def pose_val(pose: Optional[dict], k: str) -> Optional[float]:
    if not pose:
        return None
    v = pose.get(k)
    return float(v) if isinstance(v, (int, float)) else None


def strip_caption(caption: Optional[str], calls: List[str]) -> Optional[str]:
    """Drop a leading 'Step N: ' and a restated call label (the console already shows both)."""
    if not caption:
        return None
    c = re.sub(r"^Step \d+:\s*", "", caption.strip())
    c = re.sub(r"^initial view\s*[,:;—–-]\s*", "", c, flags=re.I)   # the log already says "initial view"
    for call in calls:
        label = call_parts(call)[0].replace("_", " ")
        if c.lower().startswith(label.lower()):
            c = c[len(label):].lstrip(" ,;:—–-").strip()
            if c.startswith("(") and c.endswith(")"):
                c = c[1:-1]
            break
    if not c:
        return None
    if c.lower() in ("initial view",):
        return None
    return c[0].upper() + c[1:]


class Episode:
    def __init__(self, ep: dict, pace: Pace, frames_root: Path, step_budget: int):
        self.ep, self.pace, self.step_budget = ep, pace, step_budget
        hero = pace.name.startswith("hero")
        if ep["aspect"] == "1:1":
            self.L = SQ_HERO if hero else SQ
        else:
            self.L = WIDE
        self.has_pose = any(fr.get("pose") for fr in ep["frames"])   # pose line and tape only if the data has poses
        self.id = ep["id"]
        self.task = ep.get("task")
        self.kind = ep["kind"]
        self.frames = ep["frames"]
        self.n = len(self.frames)
        if self.n < 1:
            raise SystemExit(f"{self.id}: no frames")
        self.imgs = [FrameImg(frames_root / fr["src"], self.L.vw, self.L.vh, fr["w"], fr["h"]) for fr in self.frames]
        self.task_color = C.TASK.get(self.task, C.ACCENT)
        self.strings: List[str] = []           # every string drawn (for the QA manifest)
        self.warnings: List[str] = []
        self._plan()
        self._static()

    # ------------------------------------------------------------------ plan
    def _analyze(self, k: int) -> List[Op]:
        fr, prev = self.frames[k], (self.frames[k - 1] if k > 0 else {})
        calls = list(fr.get("calls") or [])
        results = fr.get("results")
        p0, p1 = prev.get("pose"), fr.get("pose")
        h0, h1 = pose_val(p0, "heading"), pose_val(p1, "heading")
        q0, q1 = pose_val(p0, "pitch"), pose_val(p1, "pitch")
        f0, f1 = pose_val(p0, "fov"), pose_val(p1, "fov")
        kinds = [op_kind(call_parts(c)[0]) for c in calls]
        n_h, n_v, n_z = kinds.count("pan_h"), kinds.count("pan_v"), kinds.count("zoom")
        heading = h0
        fov = f0 if f0 else 90.0
        ops: List[Op] = []
        for j, c in enumerate(calls):
            name, nums = call_parts(c)
            kind = kinds[j]
            res, style = result_for(kind, results[j] if isinstance(results, list) and j < len(results) else None, heading)
            op = Op(call=c, name=name, kind=kind, result=res, style=style, failed=(style == "error"))
            f_px = (self.L.vw / 2) / math.tan(math.radians(min(max(fov, 5.0), 170.0)) / 2)
            if op.failed:
                pass
            elif kind == "pan_h":
                sign = 1.0 if name == "scroll_right" else -1.0
                deg = nums[0] if nums else None
                if n_h == 1 and h0 is not None and h1 is not None:
                    d = (h1 - h0) % 360 if sign > 0 else (h0 - h1) % 360
                    if deg is not None and abs(((d - deg) + 180) % 360 - 180) > 0.5:
                        self.warnings.append(f"{self.id} frame {k + 1}: {c} but pose heading {h0}->{h1}")
                    deg = d
                deg = 30.0 if deg is None else deg
                op.dh = sign * deg
                op.rdx = -sign * f_px * math.tan(math.radians(min(deg, 60.0)))
                if heading is not None:
                    heading = (heading + op.dh) % 360
            elif kind == "pan_v":
                sign = 1.0 if name == "scroll_up" else -1.0
                deg = nums[0] if nums else None
                if n_v == 1 and q0 is not None and q1 is not None:
                    d = (q1 - q0) * sign
                    if deg is not None and abs(d - deg) > 0.5:
                        self.warnings.append(f"{self.id} frame {k + 1}: {c} but pose pitch {q0}->{q1}")
                    deg = abs(d)
                deg = 15.0 if deg is None else deg
                op.dp = sign * deg
                op.rdy = sign * f_px * math.tan(math.radians(min(deg, 60.0)))
            elif kind == "zoom":
                zin = name == "zoom_in"
                if n_z == 1 and f0 and f1 and abs(f0 - f1) > 1e-6:
                    zk = math.tan(math.radians(f0) / 2) / math.tan(math.radians(f1) / 2)
                    if (zk > 1) != zin:
                        self.warnings.append(f"{self.id} frame {k + 1}: {c} but pose fov {f0}->{f1}")
                else:
                    zk = 2.0 ** (nums[0] if nums else 1.0)
                    zk = zk if zin else 1 / zk
                op.zk = min(max(zk, 1 / 3.2), 3.2)
                fov = math.degrees(2 * math.atan(math.tan(math.radians(fov) / 2) / op.zk))
            ops.append(op)
        if k > 0 and h1 is not None and heading is not None and abs(((heading - h1) + 180) % 360 - 180) > 0.5:
            self.warnings.append(f"{self.id} frame {k + 1}: calls give heading {heading:.1f}, pose says {h1}")
        return ops

    def _op_dur(self, op: Op) -> float:
        P = self.pace
        if op.failed:
            return P.other
        if op.kind == "pan_h":
            return P.pan_base + P.pan_per90 * min(1.0, abs(op.dh) / 90.0)
        if op.kind == "pan_v":
            return P.pan_base + P.pan_per90 * min(1.0, abs(op.dp) / 90.0)
        return {"zoom": P.zoom, "move": P.move, "capture": P.capture, "check": P.check}.get(op.kind, P.other)

    def _vsegs(self, ops: List[Op], same_image: bool) -> List[VSeg]:
        vw, vh = self.L.vw, self.L.vh
        vis = lambda o: (not o.failed) and o.kind in ("pan_h", "pan_v", "zoom", "capture")  # noqa: E731

        def op_m(o: Op, cap: float) -> Tuple[float, float, float]:
            if o.kind in ("pan_h", "pan_v"):
                dx = max(-cap * vw, min(cap * vw, o.rdx))
                dy = max(-cap * vh, min(cap * vh, o.rdy))
                return (1.0, dx, dy)
            if o.kind == "zoom":
                return (o.zk, 0.0, 0.0)
            return M_ID

        segs: List[VSeg] = []
        moves = [j for j, o in enumerate(ops) if o.kind == "move" and not o.failed]
        if not moves:
            vidx = [j for j, o in enumerate(ops) if vis(o)]
            if not vidx:                                    # nothing visual: crossfade during the last op
                for j, o in enumerate(ops):
                    last = j == len(ops) - 1
                    segs.append(VSeg(o.t0, o.t1, "cross" if (last and not same_image) else "hold"))
                return segs
            last = vidx[-1]
            ms = [op_m(o, 0.55 if j == last else 0.2) for j, o in enumerate(ops)]
            cfin = M_ID
            for j in vidx:
                cfin = m_comp(ms[j], cfin)
            cinv = m_inv(cfin)
            base = M_ID
            for j, o in enumerate(ops):
                if j < last:
                    segs.append(VSeg(o.t0, o.t1, "old" if vis(o) else "hold", base=base, op=ms[j] if vis(o) else M_ID))
                    if vis(o):
                        base = m_comp(ms[j], base)
                elif j == last:
                    if o.kind == "zoom":
                        curve = (0.4, 1.0) if o.zk > 1 else (0.0, 0.6)
                    elif o.kind == "capture":
                        curve = (0.0, 0.7)
                    else:
                        curve = (0.12, 0.88)
                    segs.append(VSeg(o.t0, o.t1, "cross", base=base, op=ms[j], cinv=cinv, curve=curve,
                                     flash=o.kind == "capture"))
                else:
                    segs.append(VSeg(o.t0, o.t1, "hold_new"))
            return segs
        m0 = moves[0]
        post_vis = [j for j in range(m0 + 1, len(ops)) if vis(ops[j])]
        cpost = M_ID
        for j in post_vis:
            cpost = m_comp(op_m(ops[j], 0.2), cpost)
        cinv = m_inv(cpost)
        base = M_ID
        post_base = M_ID
        switched = False
        for j, o in enumerate(ops):
            if j < m0:
                if vis(o):
                    m = op_m(o, 0.2)
                    segs.append(VSeg(o.t0, o.t1, "old", base=base, op=m))
                    base = m_comp(m, base)
                else:
                    segs.append(VSeg(o.t0, o.t1, "hold", base=base))
            elif j == m0:
                segs.append(VSeg(o.t0, o.t1, "push_out" if post_vis else "push_cross", base=base))
                switched = not post_vis
            elif vis(o):
                m = op_m(o, 0.2)
                if not switched:
                    segs.append(VSeg(o.t0, o.t1, "post_in", base=post_base, op=m, cinv=cinv,
                                     flash=o.kind == "capture", settle=o.kind == "capture"))
                    switched = True
                else:
                    segs.append(VSeg(o.t0, o.t1, "post", base=post_base, op=m, cinv=cinv, flash=o.kind == "capture"))
                post_base = m_comp(m, post_base)
            elif o.kind == "move" and not o.failed:
                segs.append(VSeg(o.t0, o.t1, "bump", base=post_base, cinv=cinv))
            else:
                segs.append(VSeg(o.t0, o.t1, "hold_new" if switched else "transit", base=post_base, cinv=cinv))
        return segs

    def _schedule(self, st: Step, ops: List[Op], t: float, nd: int) -> float:
        """Type the step's calls, then run them one after another; returns when the last one ends."""
        P = self.pace
        tc = st.t_type0 = t
        first_row = len(self.rows)
        for j, op in enumerate(ops):
            dur = max(P.type_min, len(op.call) / P.cps)
            self.rows.append(Row(kind="call", t_add=tc, text=op.call, gutter=f"{st.k + 1:0{nd}d}" if j == 0 else "",
                                 t_type=(tc, tc + dur), result=op.result, style=op.style))
            tc += dur + P.type_gap
        if not ops:
            self.rows.append(Row(kind="sys", t_add=tc, text="(no call recorded)", gutter=f"{st.k + 1:0{nd}d}"))
            tc += P.type_min
        st.t_exec0 = tc - (P.type_gap if ops else 0) + P.pre_exec
        te = st.t_exec0
        for j, op in enumerate(ops):
            op.t0 = te
            op.t1 = te + self._op_dur(op)
            te = op.t1 + (P.op_gap if j < len(ops) - 1 else 0.0)
            self.rows[first_row + j].t_exec = (op.t0, op.t1)
        if not ops:
            te = st.t_exec0 + P.other
        st.ops = ops
        return te

    def _plan(self) -> None:
        P = self.pace
        self.t_title1 = P.title
        self.t_open1 = P.title + P.open
        self.steps: List[Step] = []
        self.rows: List[Row] = []
        self.prompt_windows: List[Tuple[float, float]] = []
        nd = max(2, len(str(self.n)))
        # frame 1: either the initial view (Figure 1, walkthrough: calls == []) or the view returned by the
        # episode's first calls (replays: BFCL agents start with capture_view(); nothing is shown before it)
        self.first_calls = bool(self.frames[0].get("calls"))
        s0 = Step(k=0)
        if self.first_calls:
            ops = self._analyze(0)
            t0 = self.t_open1 + P.pre_type
            self.prompt_windows.append((P.title + 0.6, t0))
            te = self._schedule(s0, ops, t0, nd)
            vis = [j for j, o in enumerate(ops) if not o.failed and o.kind in ("pan_h", "pan_v", "zoom", "capture")]
            last = vis[-1] if vis else len(ops) - 1
            s0.vsegs = [VSeg(o.t0, o.t1, "empty" if j < last else "first_in" if j == last else "first_hold",
                             flash=(j == last and o.kind == "capture")) for j, o in enumerate(ops)]
            s0.t_arrive = te
            s0.t_reveal0 = te + P.settle
            cap = strip_caption(self.frames[0].get("caption"), [o.call for o in ops])
            if cap:
                self.rows.append(Row(kind="note", t_add=te + 0.12, text=cap))
            idle_from = te + P.settle + 0.1
        else:
            s0.t_arrive = s0.t_exec0 = P.title
            s0.t_reveal0 = self.t_open1 + P.first_extra
            self.rows.append(Row(kind="sys", t_add=P.title + 0.35, text="initial view", gutter=f"{1:0{nd}d}"))
            cap = strip_caption(self.frames[0].get("caption"), [])
            if cap:
                self.rows.append(Row(kind="note", t_add=P.title + 0.55, text=cap))
            idle_from = P.title + 0.75
        s0.t_reveal1 = s0.t_reveal0 + (P.reveal if self._has_marks(0) else 0.0)
        s0.t_hold1 = s0.t_reveal1 + (P.hold_clues if self._has_marks(0) else P.hold_plain)
        self.steps.append(s0)
        t = s0.t_hold1
        for k in range(1, self.n):
            st = Step(k=k)
            prev_pose = self.frames[k - 1].get("pose")
            st.h0, st.p0, st.f0 = (pose_val(prev_pose, "heading"), pose_val(prev_pose, "pitch"),
                                   pose_val(prev_pose, "fov"))
            ops = self._analyze(k)
            self.prompt_windows.append((idle_from, t + P.pre_type))
            te = self._schedule(st, ops, t + P.pre_type, nd)
            same = self.imgs[k].md5 == self.imgs[k - 1].md5
            st.vsegs = self._vsegs(ops, same) if ops else [VSeg(st.t_exec0, te, "cross" if not same else "hold")]
            st.t_arrive = te
            cap = strip_caption(self.frames[k].get("caption"), [o.call for o in ops])
            if cap:
                self.rows.append(Row(kind="note", t_add=te + 0.12, text=cap))
            st.t_reveal0 = te + P.settle
            st.t_reveal1 = st.t_reveal0 + (P.reveal if self._has_marks(k) else 0.0)
            st.t_hold1 = st.t_reveal1 + (P.hold_clues if self._has_marks(k) else P.hold_plain)
            self.steps.append(st)
            idle_from = te + P.settle + 0.1
            t = st.t_hold1
        self.after_rows_t = t
        extra = (self.ep.get("after_last_frame") or {}) if self.kind == "replay" else {}
        if extra.get("calls"):
            tc = t + P.pre_type
            self.prompt_windows.append((idle_from, tc))
            res = extra.get("results") or [None] * len(extra["calls"])
            for j, c in enumerate(extra["calls"]):
                kind = op_kind(call_parts(c)[0])
                r, style = result_for(kind, res[j] if j < len(res) else None, None)
                dur = max(P.type_min, len(c) / P.cps)
                self.rows.append(Row(kind="call", t_add=tc, text=c, gutter="+" if j == 0 else "", t_type=(tc, tc + dur),
                                     t_exec=(tc + dur + 0.1, tc + dur + 0.1 + P.other), result=r, style=style))
                tc += dur + 0.1 + P.other + P.op_gap
            t = tc + 0.6
            idle_from = t
        self.t_close0 = t
        self.t_close1 = t + P.close
        self.T = self.t_close1 + P.end
        self.prompt_windows.append((idle_from, self.t_close0))
        for txt, color in self._final_rows():
            self.rows.append(Row(kind="answer" if color else "sys", t_add=self.t_close0 + 0.1, text=txt, color=color))
        self._layout_rows()

    def _has_marks(self, k: int) -> bool:
        fr = self.frames[k]
        return bool(fr.get("clues")) or bool(fr.get("notes"))

    def _final_rows(self) -> List[Tuple[str, Optional[Tuple[int, int, int]]]]:
        if self.kind == "illustrative":
            return [("end of illustrative trace", None)]
        if self.kind == "env_tour":
            return [("end of API test", None)]
        ended = self.ep.get("ended")
        ans = self.ep.get("answer")
        out: List[Tuple[str, Optional[Tuple[int, int, int]]]] = []
        if ans and ans.get("text") is not None:
            out.append((f"answer: {ans['text']}", C.INK))
        elif ended == "step_limit":
            out.append(("no answer: step limit reached", None))
        elif ended == "error":
            out.append(("episode ended with an error", None))
        else:
            out.append(("no answer", None))
        return out

    # ------------------------------------------------------- console layout
    def _layout_rows(self) -> None:
        L = self.L
        mono = font("mono", L.log_size, 450)
        sans = font("sans", L.note_size, 400)
        log_w = L.tx1 - L.tx0
        nd = max(2, len(str(self.n)))
        pre_w = mono.getlength("0" * nd + " › ")
        self.pre_w = pre_w
        for row in self.rows:
            if row.kind in ("call", "sys", "answer"):
                avail = log_w - pre_w
                parts = wrap(row.text, mono, avail)
                row.lines = [(p, pre_w, "mono") for p in parts]
                if row.kind == "call" and row.result is not None:
                    res = "← " + row.result
                    rw = mono.getlength(res)
                    last_end = pre_w + mono.getlength(parts[-1])
                    if last_end + mono.getlength("  ") + rw <= log_w and row.style != "error":
                        row.res_xy = (log_w - rw, len(parts) - 1)
                        self.strings.append(res)          # drawn at the line's end, not one of row.lines
                    else:
                        rparts = wrap(res, mono, avail - mono.getlength("  "))
                        x = pre_w + mono.getlength("  ")
                        row.res_xy = (x, len(parts))
                        for p in rparts:
                            row.lines.append((p, x, "result"))
                row.height = L.log_lh * len(row.lines)
            elif row.kind == "note":
                parts = wrap(row.text, sans, log_w - pre_w)
                if len(parts) > 4:
                    blk = fit(row.text, "sans", 400, log_w - pre_w, 4, L.note_size, L.note_size - 2, what="caption")
                    parts = blk.lines
                row.lines = [(p, pre_w, "note") for p in parts]
                row.height = L.note_lh * len(parts) + 4
            for text, x, _ in row.lines:
                f = sans if _ == "note" else mono
                if x + f.getlength(text) > log_w + 0.5:
                    raise Overflow(f"{self.id}: console line {text!r} exceeds {log_w}px")
                self.strings.append(text)

    # ------------------------------------------------------- static layers
    def _static(self) -> None:
        self._title_img: Optional[Image.Image] = None
        self._end_img: Optional[Image.Image] = None
        self._console_static: Optional[Image.Image] = None
        self.end_markers: List[Tuple[float, float, str]] = []
        self.console_layout()
        self.title_card()          # build once so overflow errors surface before encoding
        self.end_card()

    # ------------------------------------------------------- state(t)
    def step_at(self, t: float) -> int:
        """Index of the latest frame shown at time t (-1: no view yet)."""
        k = -1 if (self.first_calls and t < self.steps[0].t_arrive) else 0
        for st in self.steps[1:]:
            if t >= st.t_arrive:
                k = st.k
        return k

    def exec_step(self, t: float) -> Optional[Step]:
        for st in self.steps:
            if st.ops and st.t_exec0 <= t < st.t_arrive:
                return st
        return None

    def camera_at(self, t: float) -> Tuple[Optional[float], Optional[float], Optional[float], float]:
        """Heading, pitch, fov at time t (interpolated through the calls) and a check_direction pulse."""
        st = self.exec_step(t)
        if st is not None and st.k == 0:
            st = None
        if st is None:
            k = self.step_at(t)
            if k < 0:
                return None, None, None, 0.0
            p = self.frames[k].get("pose")
            return pose_val(p, "heading"), pose_val(p, "pitch"), pose_val(p, "fov"), 0.0
        p1 = self.frames[st.k].get("pose")
        h, q, f = st.h0, st.p0, st.f0
        if h is None or pose_val(p1, "heading") is None:
            h = None
        pulse = 0.0
        for o in st.ops:
            e = ease_io(ramp(t, o.t0, o.t1))
            if t < o.t0:
                break
            if h is not None:
                h = h + o.dh * e
            if q is not None:
                q = q + o.dp * e
            if f is not None and o.kind == "zoom" and not o.failed:
                f = math.degrees(2 * math.atan(math.tan(math.radians(f) / 2) / (o.zk ** e)))
            if o.kind == "check" and o.t0 <= t < o.t1 + 0.4:
                pulse = math.sin(math.pi * ramp(t, o.t0, o.t1 + 0.4))
        return (h % 360 if h is not None else None), q, f, pulse

    def view_at(self, t: float) -> dict:
        st = self.exec_step(t)
        if st is None:
            k = self.step_at(t)
            return {"static": k} if k >= 0 else {"empty": 1}
        if st.k == 0:                                  # the first view arrives
            segs = [v for v in st.vsegs if v.t0 <= t]
            vs = segs[-1] if segs else st.vsegs[0]
            u = ramp(t, vs.t0, vs.t1)
            if vs.mode == "empty":
                return {"empty": 1}
            if vs.mode == "first_hold":
                return {"static": 0}
            a = smooth(ramp(u, 0.0, 0.75))
            sc = 1.05 ** (1 - ease_io(u))
            return {"layers": [[0, r4(sc), 0.0, 0.0, r4(a)]], "wb": EPS_W,
                    "flash": r4(shutter(t - vs.t0) if vs.flash else 0.0), "bd": -1, "comp": "over"}
        segs = [v for v in st.vsegs if v.t0 <= t]
        vs = segs[-1] if segs else st.vsegs[0]
        old, new = st.k - 1, st.k
        u = ramp(t, vs.t0, vs.t1)
        e = ease_io(u)
        layers: List[list] = []
        wb = EPS_W
        flash = 0.0
        comp = "over"           # layers alpha-composited in order over the backdrop (feathered edges)
        if vs.mode in ("old", "hold", "cross"):
            mo = m_comp(m_part(vs.op, e), vs.base) if vs.mode != "hold" else vs.base
            if vs.mode == "cross":
                a = smooth(ramp(e, vs.curve[0], vs.curve[1]))
                mn = m_comp(mo, vs.cinv)
                if vs.op[0] > 1.0 + 1e-9:           # zoom in: the enlarged old view is the base
                    layers = [[old, *mo, 1.0], [new, *mn, a]]
                elif vs.op[0] < 1.0 - 1e-9:         # zoom out: the enlarged new view is the base
                    layers = [[new, *mn, 1.0], [old, *mo, 1 - a]]
                else:                               # pan / capture: each fills what the other leaves
                    comp = "norm"
                    layers = [[old, *mo, 1 - a], [new, *mn, a]]
                if vs.flash:
                    flash = shutter(t - vs.t0)
            else:
                layers = [[old, *mo, 1.0]]
        elif vs.mode in ("push_out", "push_cross"):
            mo = m_comp(m_part((1.32, 0.0, 0.0), e), vs.base)
            a = smooth(u)
            if vs.mode == "push_out":
                layers = [[old, *mo, 1 - a]]
            else:
                mn = (1.07 ** (1 - e), 0.0, 0.0)
                layers = [[old, *mo, 1.0], [new, *mn, a]]
        elif vs.mode in ("post_in", "post", "transit", "hold_new", "bump"):
            if vs.mode == "transit":
                layers, wb = [], 1.0
            elif vs.mode == "hold_new":
                layers = [[new, *m_comp(vs.base, vs.cinv), 1.0]]
            elif vs.mode == "bump":
                s = 1 + 0.045 * math.sin(math.pi * u)
                layers = [[new, *m_comp((s, 0.0, 0.0), m_comp(vs.base, vs.cinv)), 1.0]]
            else:
                mc = m_comp(m_part(vs.op, e), vs.base)
                mn = m_comp(mc, vs.cinv)
                if vs.settle:
                    mn = m_comp((1.05 ** (1 - e), 0.0, 0.0), mn)
                if vs.mode == "post_in":
                    a = smooth(ramp(u, 0.0, 0.75))
                    layers = [[new, *mn, a]]
                else:
                    layers = [[new, *mn, 1.0]]
                if vs.flash:
                    flash = shutter(t - vs.t0)
        return {"layers": [[i, r4(s), r4(x), r4(y), r4(w)] for i, s, x, y, w in layers], "wb": r4(wb),
                "flash": r4(flash), "bd": old, "comp": comp}

    def marks_at(self, t: float) -> Tuple[Optional[list], Optional[list]]:
        k = self.step_at(t)
        if k < 0:
            return None, None
        st = self.steps[k]
        nxt = self.steps[k + 1].t_type0 if k + 1 < self.n else self.t_close0
        out_a = 1 - ramp(t, nxt, nxt + 0.25)
        if t < st.t_reveal0 or out_a <= 0:
            return None, None
        fr = self.frames[k]
        boxes = None
        if fr.get("clues"):
            n_c = len(fr["clues"])
            done = min(0.06, 0.35 / max(1, n_c)) * n_c + 0.4
            boxes = [k, r4(min(t - st.t_reveal0, done)), r4(out_a)]
        notes = None
        if fr.get("notes"):
            na = smooth(ramp(t, st.t_reveal0 + 0.35 * self.pace.reveal, st.t_reveal0 + 0.35 * self.pace.reveal + 0.3))
            if na > 0:
                notes = [k, r4(na * out_a)]
        return boxes, notes

    def toast_at(self, t: float) -> Optional[list]:
        if not self.L.toast:
            return None
        st = None
        for s in self.steps:
            if s.ops and s.t_exec0 - 0.05 <= t < s.t_arrive + 0.6:
                st = s
        if st is None or not st.ops:
            return None
        cur = st.ops[0]
        for o in st.ops:
            if t >= o.t0:
                cur = o
        a = smooth(ramp(t, st.t_exec0 - 0.05, st.t_exec0 + 0.12)) * (1 - smooth(ramp(t, st.t_arrive + 0.35, st.t_arrive + 0.6)))
        done = t >= cur.t1
        return [cur.call, cur.result if done else None, cur.style, r4(a)]

    def console_at(self, t: float) -> dict:
        rows = []
        for i, row in enumerate(self.rows):
            if t < row.t_add:
                continue
            chars = len(row.text)
            if row.kind == "call":
                chars = int(len(row.text) * ramp(t, row.t_type[0], row.t_type[1]) + 1e-6)
            res_on = row.kind == "call" and t >= row.t_exec[1]
            ex = r4(ramp(t, row.t_exec[0], row.t_exec[1])) if (row.kind == "call" and row.t_exec[0] <= t < row.t_exec[1]) else -1
            grow = r4(smooth(ramp(t, row.t_add, row.t_add + 0.18)))
            typing = row.kind == "call" and row.t_type[0] <= t < row.t_type[1] + 0.12
            rows.append([i, chars, res_on, ex, grow, typing])
        prompt = any(a <= t < b for a, b in self.prompt_windows)
        cursor = any(r[5] for r in rows) or (int(t * 2.0) % 2 == 0)
        h, q, f, pulse = self.camera_at(t)
        k = self.step_at(t)
        return {"rows": rows, "prompt": prompt, "cursor": cursor, "k": k,
                "pose": [None if h is None else round(h), None if q is None else round(q), None if f is None else round(f)]}

    def state(self, t: float) -> dict:
        P = self.pace
        fade = max(1 - ramp(t, 0, P.fade_in), ramp(t, self.T - P.fade_out, self.T))
        st: Dict[str, Any] = {"fade": r4(smooth(fade))}
        if t < self.t_title1:
            st["phase"] = "title"
            return st
        if t < self.t_open1:
            u = ramp(t, self.t_title1, self.t_open1)
            st["phase"], st["open"], st["open_mix"] = "open", r4(ease_out(u)), r4(smooth(u))
        elif t < self.t_close0:
            st["phase"] = "body"
        elif t < self.t_close1:
            st["phase"], st["close"] = "close", r4(smooth(ramp(t, self.t_close0, self.t_close1)))
        else:
            st["phase"] = "end"
        if st["phase"] in ("close", "end"):
            st["end_t"] = r4(t - self.t_close0)
        if st["phase"] != "end":
            st["view"] = self.view_at(t)
            st["boxes"], st["notes"] = self.marks_at(t)
            h, q, f, pulse = self.camera_at(t)
            if h is not None:
                ta = 1.0
                if st["phase"] == "open":
                    ta = st["open"]
                if st["phase"] == "close":
                    ta = 1 - st["close"]
                st["tape"] = [r4(h), r4(f or 90.0), r4(pulse), r4(ta)]
            st["toast"] = self.toast_at(t)
        st["console"] = self.console_at(t)
        return st

    # ------------------------------------------------------- rendering
    def render(self, st: dict) -> Image.Image:
        if st["phase"] == "title":
            return fade_to_bg(self.title_card(), st["fade"])
        L = self.L
        frame = Image.new("RGB", (W, H), C.BG)
        if st["phase"] == "end":
            view = self.end_card_live(st["end_t"])
        else:
            view = self.render_view(st["view"]).convert("RGBA")
            self.draw_marks(view, st)
            if st["phase"] == "close":
                endv = self.end_card_live(st["end_t"])
                view = Image.blend(view, endv, st["close"])
        if L.translucent:
            frame.paste(view.convert("RGB"), (0, 0))
        else:
            frame.paste(view.convert("RGB").crop((0, 0, L.view_x1, H)), (0, 0))
        slide = 1.0 if st["phase"] != "open" else st["open"]
        self.draw_console(frame, st["console"], slide)
        if st["phase"] == "open":
            frame = Image.blend(self.title_card(), frame, st["open_mix"])
        return fade_to_bg(frame, st["fade"])

    def render_view(self, vs: dict) -> Image.Image:
        if "static" in vs:
            return self.imgs[vs["static"]].view
        if "empty" in vs:
            return self.empty_view()
        L = self.L
        layers = [(i, (s, x, y), w) for i, s, x, y, w in vs["layers"] if w > 1e-3]
        if len(layers) == 1 and layers[0][1] == M_ID and abs(layers[0][2] - 1) < 1e-6 and vs["flash"] == 0:
            return self.imgs[layers[0][0]].view
        bd = self.imgs[vs["bd"]].bd if vs["bd"] >= 0 else np.asarray(self.empty_view(), np.float32)

        def layer(i: int, m: Tuple[float, float, float]) -> Tuple[np.ndarray, np.ndarray]:
            img = self.imgs[i]
            if m == M_ID:
                return img.arr, np.ones((L.vh, L.vw), np.float32)
            return np.asarray(img.warp(m), np.float32), img.coverage(m)

        if vs.get("comp") == "norm":
            # normalised blend: where only one view covers a pixel it is shown at full strength
            num = bd * vs["wb"]
            den = np.full((L.vh, L.vw), vs["wb"], np.float32)
            for i, m, w in layers:
                arr, cov = layer(i, m)
                ww = cov * w
                num = num + arr * ww[..., None]
                den = den + ww
            out = num / den[..., None]
        else:
            out = bd
            for i, m, w in layers:
                arr, cov = layer(i, m)
                ww = (cov * w)[..., None]
                out = out * (1 - ww) + arr * ww
        if vs["flash"] > 0:
            out = out + vs["flash"] * (255 - out)
        return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8))

    @lru_cache(maxsize=1)
    def empty_view(self) -> Image.Image:
        """Viewport before the first image-returning call (replays)."""
        L = self.L
        im = Image.new("RGBA", (L.vw, L.vh), rgba(C.SURFACE))
        cv = Canvas(im)
        f = font("mono", 16, 500)
        cx = L.view_x1 / 2
        cv.text((cx, L.vh / 2), "no view yet", f, rgba(C.MUTED), anchor="ms", what="empty view")
        self.strings += cv.strings
        return im.convert("RGB")

    # ---- clue boxes, notes, heading tape, toast
    def draw_marks(self, view: Image.Image, st: dict) -> None:
        L = self.L
        layer = Image.new("RGBA", view.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        if st.get("boxes"):
            k, tt, a = st["boxes"]
            img = self.imgs[k]
            clues = self.frames[k]["clues"]
            stagger = min(0.06, 0.35 / max(1, len(clues)))
            for j, c in enumerate(clues):
                p = smooth(ramp(tt, j * stagger, j * stagger + 0.38))
                if p <= 0:
                    continue
                x0, y0, x1, y1 = img.box_xy(c["box"])
                x0, y0 = max(x0, 4), max(y0, 4)
                x1, y1 = min(x1, L.view_x1 - 5), min(y1, L.vh - 5)
                g = 14 * (1 - p)
                x0, y0, x1, y1 = (int(round(x0 - g)), int(round(y0 - g)), int(round(x1 + g)), int(round(y1 + g)))
                al = p * a
                d.rectangle((x0 - 3, y0 - 3, x1 + 3, y1 + 3), outline=rgba(C.WHITE, al), width=7)
                clue_outline(d, (x0 - 1, y0 - 1, x1 + 1, y1 + 1), rgba(C.CLUE[c["kind"]], al), 3, c["kind"])
        if st.get("notes"):
            k, a = st["notes"]
            for spr, (x, y) in self.note_sprites(k):
                layer.alpha_composite(alpha_mul(spr, a), (x, y))
        if st.get("tape"):
            h, f, pulse, a = st["tape"]
            if a > 0:
                spr, (x, y) = self.tape_sprite(h, f, pulse)
                layer.alpha_composite(alpha_mul(spr, a), (x, y))
        if st.get("toast"):
            call, res, style, a = st["toast"]
            if a > 0:
                spr, (x, y) = self.toast_sprite(call, res, style)
                layer.alpha_composite(alpha_mul(spr, a), (x, y))
        view.alpha_composite(layer)

    @lru_cache(maxsize=64)
    def note_sprites(self, k: int) -> List[Tuple[Image.Image, Tuple[int, int]]]:
        L = self.L
        f = font("sans", L.pill_size, 650)
        h = L.pill_h
        sc = L.pill_h / 30
        pad, sq, gap = int(round(11 * sc)), int(round(10 * sc)), int(round(8 * sc))
        x_min, x_max = SAFE, L.view_x1 - SAFE
        pills = []
        for n in self.frames[k]["notes"]:
            text = n["text"]
            maxw = x_max - x_min - 2 * pad - sq - gap
            if f.getlength(text) > maxw:
                raise Overflow(f"{self.id}: note {text!r} wider than the frame")
            w = int(math.ceil(2 * pad + sq + gap + f.getlength(text)))
            im = rrect(w, h, h / 2, rgba(C.OVERLAY, 0.94)).copy()
            dd = ImageDraw.Draw(im)
            yy = (h - sq) // 2
            clue_swatch(dd, pad, yy, sq, n["kind"])
            cv = Canvas(im, safe=False)
            cv.text((pad + sq + gap, (h + cap_h(f)) / 2), text, f, rgba(C.INK), box=(0, 0, w, h), what="note")
            self.strings.append(text)
            pills.append(im)
        # flow left to right, wrapping upwards
        rows: List[List[Image.Image]] = [[]]
        x = x_min
        for p in pills:
            if rows[-1] and x + p.width > x_max:
                rows.append([])
                x = x_min
            rows[-1].append(p)
            x += p.width + gap

        def place(align: str) -> List[Tuple[Image.Image, Tuple[int, int]]]:
            out = []
            y = L.notes_y1 - h
            for row in rows:
                x = x_min if align == "left" else x_max - (sum(p.width for p in row) + gap * (len(row) - 1))
                for p in row:
                    out.append((p, (x, y)))
                    if x < SAFE or x + p.width > x_max or y < SAFE:
                        raise Overflow(f"{self.id}: note pill outside the safe area")
                    x += p.width + gap
                y -= h + int(round(6 * sc))
            return out

        # Bottom-left, unless a pill would cover or crowd a clue box (its white halo plus a 10 px margin)
        # there and not at the bottom right: the pills never hide the clue they name.
        boxes = []
        for c in self.frames[k].get("clues") or []:
            x0, y0, x1, y1 = self.imgs[k].box_xy(c["box"])
            boxes.append((max(x0, 4) - 13, max(y0, 4) - 13, min(x1, L.view_x1 - 5) + 13, min(y1, L.vh - 5) + 13))

        def crowds(placed: List[Tuple[Image.Image, Tuple[int, int]]]) -> bool:
            return any(x < bx1 and x + p.width > bx0 and y < by1 and y + p.height > by0
                       for p, (x, y) in placed for bx0, by0, bx1, by1 in boxes)

        out = place("left")
        if crowds(out):
            alt = place("right")
            if not crowds(alt):
                out = alt
        return out

    def tape_sprite(self, heading: float, fov: float, pulse: float) -> Tuple[Image.Image, Tuple[int, int]]:
        """Compass heading tape: 1 deg = viewport width / FOV px, readout pill at the camera direction."""
        L = self.L
        x0, y0, x1, y1 = L.tape_box
        bw, bh = x1 - x0, y1 - y0
        ss = 3
        big = Image.new("RGBA", (bw * ss, bh * ss), (0, 0, 0, 0))
        big.alpha_composite(rrect(bw * ss, bh * ss, 8 * ss, rgba(C.OVERLAY, 0.86), ss=1), (0, 0))
        d = ImageDraw.Draw(big)
        ppd = L.vw / fov
        cx = L.tape_cx - x0
        txt = f"{int(round(heading)) % 360:03d}°"
        fr = font("mono", 14 * ss, 700)
        pw, ph = fr.getlength(txt) / ss + 18, 24
        lo = heading - cx / ppd
        hi = heading + (bw - cx) / ppd
        f_card = font("sans", 13 * ss, 800)
        f_num = font("mono", 12 * ss, 500)
        minor = 5 if ppd * 5 >= 14 else 10
        for deg in range(int(math.floor(lo / minor)) * minor, int(math.ceil(hi / minor)) * minor + 1, minor):
            x = cx + (deg - heading) * ppd
            if x < 7 or x > bw - 7:
                continue
            dm = deg % 360
            major = dm % 15 == 0 if ppd * 15 >= 40 else dm % 45 == 0
            th = 8 if major else 4
            d.rectangle(((x - 0.5) * ss, (bh - 5 - th) * ss, (x + 0.5) * ss, (bh - 5) * ss),
                        fill=rgba(C.INK if major else C.MUTED, 0.9 if major else 0.75))
            if major:
                lab = {0: "N", 90: "E", 180: "S", 270: "W", 45: "NE", 135: "SE", 225: "SW", 315: "NW"}.get(dm, str(dm))
                fl = f_card if dm % 45 == 0 else f_num
                lw = fl.getlength(lab) / ss
                if x - lw / 2 >= 8 and x + lw / 2 <= bw - 8 and abs(x - cx) > pw / 2 + lw / 2 + 6:
                    d.text((x * ss, 19 * ss), lab, font=fl, fill=rgba(C.INK if dm % 90 == 0 else C.MUTED, 1), anchor="ms")
                    self.strings.append(lab)
        py = (bh - ph) / 2
        if pulse > 0:                                   # check_direction(): the readout glows
            glow = rrect(int((pw + 10) * ss), int((ph + 8) * ss), 9 * ss, rgba(C.MARKER, 0.5 * pulse), ss=1)
            big.alpha_composite(glow, (int((cx - pw / 2 - 5) * ss), int((py - 4) * ss)))
        pill = rrect(int(pw * ss), int(ph * ss), 6 * ss, rgba(C.MARKER), ss=1)
        big.alpha_composite(pill, (int((cx - pw / 2) * ss), int(py * ss)))
        d.text((cx * ss, (py + (ph + cap_h(fr) / ss) / 2) * ss), txt, font=fr, fill=rgba(C.ON_MARKER), anchor="ms")
        self.strings.append(txt)
        if x0 < SAFE or y0 < SAFE or x1 > L.view_x1 - SAFE or y1 > H - SAFE:
            raise Overflow("heading tape outside the safe area")
        if cx - pw / 2 - 5 < 0 or cx + pw / 2 + 5 > bw:
            raise Overflow("heading readout outside the tape")
        return big.resize((bw, bh), Image.LANCZOS), (x0, y0)

    @lru_cache(maxsize=256)
    def toast_sprite(self, call: str, res: Optional[str], style: str) -> Tuple[Image.Image, Tuple[int, int]]:
        L = self.L
        f = font("mono", 16, 500)
        pad, h = 16, 38
        call_s = "› " + call
        res_s = ("   ← " + res) if res else ""
        maxw = L.view_x1 - 2 * SAFE - 2 * pad
        while f.getlength(call_s + res_s) > maxw and res_s:
            res_s = res_s[:-2] + "…"
            if len(res_s) < 8:
                res_s = ""
        if f.getlength(call_s) > maxw:
            raise Overflow(f"toast {call_s!r} too wide")
        w = int(math.ceil(f.getlength(call_s + res_s) + 2 * pad))
        im = rrect(w, h, h / 2, rgba(C.OVERLAY, 0.94), outline=rgba(C.LINE, 1), width=1).copy()
        cv = Canvas(im, safe=False)
        y = (h + cap_h(f)) / 2
        x = pad
        cv.text((x, y), "›", f, rgba(C.MARKER_TEXT), box=(0, 0, w, h), what="toast")
        x += f.getlength("› ")
        cv.text((x, y), call, f, rgba(C.INK), box=(0, 0, w, h), what="toast")
        x += f.getlength(call)
        if res_s:
            col = C.BAD if style == "error" else C.ACCENT_TEXT if style == "ok" else C.INK
            cv.text((x, y), res_s, f, rgba(col), box=(0, 0, w, h), what="toast")
        self.strings += cv.strings
        xpos = int(round((L.view_x1) / 2 - w / 2))
        ypos = H - SAFE - h
        if xpos < SAFE or xpos + w > L.view_x1 - SAFE:
            raise Overflow("toast outside the safe area")
        return im, (xpos, ypos)

    # ---- console
    def console_layout(self) -> None:
        """Static console parts (header chip, question, legend, footer) and the log box."""
        L = self.L
        cw = L.cw
        im = Image.new("RGBA", (cw, H), (0, 0, 0, 0))
        cv = Canvas(im, ox=L.cx0)
        lx0, lx1 = L.tx0 - L.cx0, L.tx1 - L.cx0
        tw = lx1 - lx0
        y = SAFE
        label = TASK_LABEL.get(self.task, "Environment walkthrough") if self.kind != "env_tour" else "Environment walkthrough"
        c1 = chip(label, L.chip_size, L.chip_h, 9, self.task_color, tr=1.1)
        cv.paste(c1, (lx0, y))
        self.counter_w = font("sans", L.counter_size, 650).getlength(f"Frame {self.n} of {self.n}")
        x = lx0 + c1.width + 8
        tag = KIND_TAG_SHORT.get(self.kind)
        if tag:
            # one size smaller if it does not fit beside the task chip and the counter; never dropped
            for size in (L.chip_size - 1, L.chip_size - 2):
                c2 = chip(tag, size, L.chip_h, 8, None, fg=C.MUTED, weight=700, tr=0.8, outline=C.LINE)
                if x + c2.width + 12 + self.counter_w <= lx1:
                    break
            else:
                raise Overflow(f"{self.id}: console header has no room for the {tag!r} chip")
            cv.paste(c2, (x, y))
        if lx0 + c1.width + 12 + self.counter_w > lx1:
            raise Overflow(f"{self.id}: console header does not fit")
        self.counter_base = y + (L.chip_h + cap_h(font("sans", L.counter_size, 650))) / 2
        self.bar_y = y + L.chip_h + 10
        y = self.bar_y + 4 + 14
        # question (or what the walkthrough is)
        if self.kind == "env_tour":
            q = "Scripted calls against the offline environment. Not a benchmark episode, not a model rollout."
        else:
            q = self.ep.get("question_short") or self.ep.get("question") or ""
        blk = fit(q, "sans", 500, tw, 3, L.q_size, L.q_min, lh=1.32, what=f"{self.id} console question", balance=True)
        cv.lines(lx0, y, blk, rgba(C.INK), box=(L.tx0, SAFE, L.tx1, H - SAFE), what="question")
        y += blk.height + 8
        if self.has_pose or self.first_calls:
            # pose readout ("HDG ... PITCH ... FOV ...", or "no view yet" before a replay's first view)
            self.pose_base = y + 14
            y = self.pose_base + 12
        else:
            self.pose_base = None
            y += 4
        ImageDraw.Draw(im).rectangle((lx0, y, lx1, y), fill=rgba(C.LINE))
        self.log_y0 = y + 12
        # footer, bottom-up
        ff = font("sans", L.foot_size, 450)
        prov = provenance_label(self.ep)
        pblk = fit(prov, "sans", 450, tw, 3, L.foot_size, L.foot_size - 1, lh=L.foot_lh / L.foot_size, what="footer")
        att_base = H - SAFE - ff.getmetrics()[1]
        base = att_base - L.foot_lh - pblk.lh * (len(pblk.lines) - 1)     # first provenance line
        foot_top = base - cap_h(pblk.font) - 10
        for i, ln in enumerate(pblk.lines):
            cv.text((lx0, base + i * pblk.lh), ln, pblk.font, rgba(C.MUTED), box=(L.tx0, SAFE, L.tx1, H - SAFE),
                    what="footer")
        cv.text((lx0, att_base), ATTRIBUTION, ff, rgba(C.INK, 0.86), box=(L.tx0, SAFE, L.tx1, H - SAFE), what="footer")
        ImageDraw.Draw(im).rectangle((lx0, foot_top, lx1, foot_top), fill=rgba(C.LINE))
        y_bottom = foot_top - 10
        if any(fr.get("clues") for fr in self.frames):
            fl = font("sans", L.legend_size, 500)
            sw = int(round(10 * L.legend_size / 13))          # swatch side
            base = y_bottom - 6
            x = lx0
            for kind, txt in (("natural", "natural clue"), ("human", "human-made clue")):
                d = ImageDraw.Draw(im)
                clue_swatch(d, x + 1, base - sw + 1, sw - 1, kind)
                x += sw + 6
                x += cv.text((x, base), txt, fl, rgba(C.MUTED), box=(L.tx0, SAFE, L.tx1, H - SAFE), what="legend") + 18
            y_bottom = base - cap_h(fl) - 14
        self.log_y1 = int(y_bottom)
        if self.log_y1 - self.log_y0 < 4 * L.log_lh:
            raise Overflow(f"{self.id}: console log area too small")
        self.strings += cv.strings
        self._console_static = im

    def draw_console(self, frame: Image.Image, cs: dict, slide: float) -> None:
        L = self.L
        x_off = 0      # the console stays put (its footer matches the title card's); the open phase cross-fades
        panel = Image.new("RGBA", (L.cw, H), (0, 0, 0, 0))
        if L.translucent:
            region = frame.crop((L.cx0, 0, W, H))
            small = region.resize((L.cw // 10, H // 10), Image.BILINEAR).resize((L.cw, H), Image.BILINEAR)
            bgc = Image.blend(small, Image.new("RGB", (L.cw, H), C.BG), 0.8)
            panel.paste(bgc, (0, 0))
            dd = ImageDraw.Draw(panel)
            dd.rectangle((0, 0, 0, H), fill=rgba(C.LINE))
        else:
            panel.paste(Image.new("RGB", (L.cw, H), C.BG), (0, 0))
        panel.alpha_composite(self._console_static)
        cv = Canvas(panel, ox=L.cx0)
        lx0, lx1 = L.tx0 - L.cx0, L.tx1 - L.cx0
        # counter + progress bar
        fc = font("sans", L.counter_size, 650)
        txt = f"Frame {cs['k'] + 1} of {self.n}" if cs["k"] >= 0 else f"Frame – of {self.n}"
        cv.text((lx1, self.counter_base), txt, fc, rgba(C.INK), anchor="rs", box=(L.tx0, SAFE, L.tx1, H - SAFE),
                what="counter")
        d = ImageDraw.Draw(panel)
        tw = lx1 - lx0
        gap = 3 if self.n <= 40 else 0
        segw = (tw - gap * (self.n - 1)) / self.n
        for i in range(self.n):
            xa = lx0 + i * (segw + gap)
            # opaque colours: ImageDraw writes a fill's alpha into the panel rather than blending it
            col = rgba(C.MARKER) if i == cs["k"] else rgba(C.HATCH) if i < cs["k"] else rgba(C.LINE)
            d.rectangle((int(round(xa)), self.bar_y, int(round(xa + segw)) - 1, self.bar_y + 3), fill=col)
        # pose readout: only what the data records (nothing is shown for a frame without a pose)
        if self.pose_base is not None:
            hdg, pit, fov = cs["pose"]
            fp = font("mono", L.pose_size, 500)
            parts = []
            if cs["k"] < 0:
                parts.append("no view yet")
            else:
                if hdg is not None:
                    parts.append(f"HDG {int(hdg) % 360:03d}°")
                if pit is not None:
                    parts.append(f"PITCH {fmt_deg(pit)}°")
                if fov is not None:
                    parts.append(f"FOV {int(fov)}°")
            ptxt = "  ·  ".join(parts)
            cv.text((lx0, self.pose_base), ptxt, fp, rgba(C.MUTED), box=(L.tx0, SAFE, L.tx1, H - SAFE), what="pose")
        self.strings += cv.strings                        # per-frame readouts (counter, pose), for the manifest
        # log
        logim = self.render_log(cs)
        panel.alpha_composite(logim, (lx0, self.log_y0))
        frame.paste(panel.convert("RGB"), (L.cx0 + x_off, 0))

    def render_log(self, cs: dict) -> Image.Image:
        L = self.L
        lw, lh_area = L.tx1 - L.tx0, self.log_y1 - self.log_y0
        im = Image.new("RGBA", (lw, lh_area), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        mono = font("mono", L.log_size, 450)
        mono_b = font("mono", L.log_size, 600)
        sans = font("sans", L.note_size, 400)
        content = sum(self.rows[r[0]].height * r[4] for r in cs["rows"])
        if cs["prompt"]:
            content += L.log_lh
        offset = max(0.0, content - lh_area + 4)
        y = -offset
        capm = cap_h(mono)
        for i, chars, res_on, ex, grow, typing in cs["rows"]:
            row = self.rows[i]
            a = grow
            if row.kind == "note":
                yy = y + 2
                for text, x, _ in row.lines:
                    base = yy + (L.note_lh + cap_h(sans)) / 2
                    d.text((x, base), text, font=sans, fill=rgba(C.MUTED, a), anchor="ls")
                    yy += L.note_lh
                d.rectangle((self.pre_w - 10, y + 5, self.pre_w - 9, y + row.height - 5), fill=rgba(C.LINE, a))
            else:
                left = chars
                cursor_at = None
                for li, (text, x, role) in enumerate(row.lines):
                    base = y + li * L.log_lh + (L.log_lh + capm) / 2
                    if li == 0:
                        if row.gutter:
                            d.text((0, base), row.gutter, font=mono, fill=rgba(C.MUTED, a), anchor="ls")
                        sym = "›" if row.kind == "call" else "•" if row.kind == "sys" else "■"
                        scol = C.MARKER_TEXT if (row.kind == "call" and ex >= 0) else C.ACCENT_TEXT if row.kind == "call" else C.MUTED
                        if row.kind == "answer":
                            scol = C.MARKER_TEXT
                        d.text((self.pre_w - mono.getlength("› "), base), sym, font=mono, fill=rgba(scol, a), anchor="ls")
                    if role == "result":
                        if res_on:
                            col = C.BAD if row.style == "error" else C.ACCENT_TEXT if row.style == "ok" else C.INK
                            d.text((x, base), text, font=mono, fill=rgba(col, a), anchor="ls")
                        continue
                    shown = text[:max(0, left)]
                    if left >= 0 and (left <= len(text) or cursor_at is None):
                        cursor_at = (x + mono.getlength(shown), base)
                    left -= len(text)
                    col = row.color or (C.INK if row.kind == "call" else C.MUTED)
                    fnt = mono_b if row.kind == "answer" else mono
                    if shown:
                        d.text((x, base), shown, font=fnt, fill=rgba(col, a), anchor="ls")
                    if li == 0 and row.kind == "call" and ex >= 0:
                        x_end = x + mono.getlength(text)
                        d.rectangle((x, base + 5, x + (x_end - x) * ex, base + 6), fill=rgba(C.MARKER, 0.9))
                if typing and cs["cursor"] and cursor_at is not None:
                    cxp, cb = cursor_at
                    d.rectangle((cxp + 1, cb - capm - 2, cxp + 0.55 * L.log_size, cb + 3), fill=rgba(C.INK, 0.9))
                if row.kind == "call" and res_on and row.res_xy is not None and row.res_xy[1] < len(row.lines) and \
                        row.lines[row.res_xy[1]][2] != "result":
                    li = row.res_xy[1]
                    base = y + li * L.log_lh + (L.log_lh + capm) / 2
                    col = C.BAD if row.style == "error" else C.ACCENT_TEXT if row.style == "ok" else C.INK
                    d.text((row.res_xy[0], base), "← " + (row.result or ""), font=mono, fill=rgba(col, a), anchor="ls")
            y += row.height * grow
        if cs["prompt"]:
            base = y + (L.log_lh + capm) / 2
            d.text((self.pre_w - mono.getlength("› "), base), "›", font=mono, fill=rgba(C.ACCENT_TEXT), anchor="ls")
            if cs["cursor"]:
                d.rectangle((self.pre_w + 1, base - capm - 2, self.pre_w + 0.55 * L.log_size, base + 3), fill=rgba(C.INK, 0.9))
        if offset > 0:                       # fade rows that scroll out at the top
            a = np.asarray(im.getchannel("A"), np.float32)
            n = min(30, lh_area)
            a[:n] *= np.linspace(0.0, 1.0, n, dtype=np.float32)[:, None]
            im.putalpha(Image.fromarray(a.astype(np.uint8)))
        return im

    # ---- title card (full frame)
    def title_card(self) -> Image.Image:
        if self._title_img is not None:
            return self._title_img
        bg = cover(self.imgs[0].src, W, H).filter(ImageFilter.GaussianBlur(26))
        im = Image.blend(bg, Image.new("RGB", (W, H), C.BG), 0.74).convert("RGBA")
        grad = np.linspace(0.35, 0.0, W, dtype=np.float32)[None, :].repeat(H, 0)
        shade = Image.new("RGBA", (W, H), rgba(C.BG, 1))
        shade.putalpha(Image.fromarray((grad * 255).astype(np.uint8)))
        im.alpha_composite(shade)
        cv = Canvas(im)
        x0, x1 = 72, W - 72
        cv.tracked(x0, 96, "GEOGUESSER BENCH", font("sans", 15, 800), rgba(C.ACCENT_TEXT), 3.0, what="wordmark")
        if self.kind == "env_tour":
            label, head = "Environment walkthrough", "Offline environment API test"
            note = "Scripted tool calls · not a benchmark episode · not a model rollout"
        else:
            label = TASK_LABEL[self.task]
            head = self.ep.get("question_short") or self.ep.get("question")
            note = self.ep.get("question_note")
        c1 = chip(label, 18, 40, 16, self.task_color, tr=1.6, sign=True, r=7)
        tag = KIND_TAG.get(self.kind, "")
        if self.kind == "replay":
            tag = f"Replay · {self.ep['model']['name']}"
        c2 = chip(tag, 14, 40, 14, None, fg=C.INK, weight=700, tr=1.2, outline=C.MUTED, r=7) if tag else None
        qb = fit(head, "sans", 650, x1 - x0, 4, 46, 28, lh=1.16, what=f"{self.id} title question", balance=True)
        nb = fit(note, "sans", 450, x1 - x0, 2, 19, 15, lh=1.3, what="title note") if note else None
        block_h = 40 + 30 + qb.height + ((16 + nb.height) if nb else 0)
        y = int(max(150, 340 - block_h / 2))
        cv.paste(c1, (x0, y))
        if c2 is not None:
            if x0 + c1.width + 12 + c2.width > x1:
                raise Overflow("title chips do not fit")
            cv.paste(c2, (x0 + c1.width + 12, y))
        y += 40 + 30
        cv.lines(x0, y, qb, rgba(C.INK), box=(x0, SAFE, x1, 600), what="title question")
        y += qb.height
        if nb:
            y += 16
            cv.lines(x0, y, nb, rgba(C.INK, 0.82), box=(x0, SAFE, x1, 600), what="title note")
            y += nb.height
        # bottom line: the walkthrough's view count or a replay's step budget (the Figure 1 card has no budget line:
        # its calls were not an agent's)
        if self.kind != "illustrative":
            fb = font("mono", 20, 600)
            if self.kind == "env_tour":
                budget = f"{self.n} views from the offline environment"
            else:
                budget = f"Step budget: {self.step_budget}"
            cv.text((x0, H - SAFE - 18), budget, fb, rgba(C.MARKER_TEXT), box=(x0, 600, self.L.tx0 - 24, H - SAFE),
                    what="title budget")
        # persistent footer at the console footer position
        im.alpha_composite(self.footer_only())
        self.strings += cv.strings
        self._title_img = im.convert("RGB")
        return self._title_img

    @lru_cache(maxsize=1)
    def footer_only(self) -> Image.Image:
        L = self.L
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        cv = Canvas(im)
        tw = L.tx1 - L.tx0
        ff = font("sans", L.foot_size, 450)
        prov = provenance_label(self.ep)
        pblk = fit(prov, "sans", 450, tw, 3, L.foot_size, L.foot_size - 1, lh=L.foot_lh / L.foot_size, what="footer")
        att_base = H - SAFE - ff.getmetrics()[1]
        base = att_base - L.foot_lh - pblk.lh * (len(pblk.lines) - 1)
        for i, ln in enumerate(pblk.lines):
            cv.text((L.tx0, base + i * pblk.lh), ln, pblk.font, rgba(C.MUTED), what="footer")
        cv.text((L.tx0, att_base), ATTRIBUTION, ff, rgba(C.INK, 0.86), what="footer")
        self.strings += cv.strings
        return im

    # ---- end card (viewport-sized RGBA, plus live marker pulse)
    def end_card(self) -> Image.Image:
        if self._end_img is not None:
            return self._end_img
        L = self.L
        last = self.imgs[-1]
        bg = Image.blend(last.view.filter(ImageFilter.GaussianBlur(22)), Image.new("RGB", (L.vw, L.vh), C.BG), 0.8)
        im = bg.convert("RGBA")
        cv = Canvas(im)
        bx0, by0, bx1, by1 = SAFE, SAFE, L.view_x1 - SAFE, H - SAFE
        box = (bx0, by0, bx1, by1)
        bw = bx1 - bx0
        y = by0
        label = TASK_LABEL.get(self.task, "Environment walkthrough") if self.kind != "env_tour" else "Environment walkthrough"
        c1 = chip(label, 12, 26, 10, self.task_color, tr=1.1)
        cv.paste(c1, (bx0, y))
        y += 26 + 22
        small_caps = font("sans", 13, 800)
        if self.kind == "env_tour":
            self._end_env(cv, y, box)
        else:
            q = self.ep.get("question_short")
            if self.task != "precise_localization" and q:
                qb = fit("Q: " + q, "sans", 500, bw, 2, 20, 16, lh=1.3, what="end question", balance=True)
                cv.lines(bx0, y - 4, qb, rgba(C.MUTED), box=box, what="end question")
                y += qb.height + 12
            ans = self.ep.get("answer")
            lab = (ans or {}).get("label") or ("Model answer" if self.kind == "replay" else "Answer")
            cv.tracked(bx0, y + 12, lab.upper(), small_caps, rgba(C.MUTED), 1.6, box=box, what="end label")
            y += 22
            if ans and ans.get("text") is not None:
                if self.task == "precise_localization":
                    ab = fit(ans["text"], "mono", 600, bw, 2, 34, 20, lh=1.2, what="end answer")
                else:
                    ab = fit(ans["text"], "sans", 800, bw, 2, 60, 26, lh=1.1, what="end answer")
                cv.lines(bx0, y, ab, rgba(C.INK), box=box, what="end answer")
                y += ab.height + 4
            else:
                ended = self.ep.get("ended")
                txt = "No final answer (step limit reached)" if ended == "step_limit" else "No final answer"
                ab = fit(txt, "sans", 700, bw, 2, 34, 20, lh=1.15, what="end answer")
                cv.lines(bx0, y, ab, rgba(C.INK), box=box, what="end answer")
                y += ab.height + 4
            if self.kind == "replay":
                y = self._end_replay(cv, im, y, box)
            else:
                y = self._end_illustrative(cv, im, y, box)
        self.strings += cv.strings
        self._end_img = im
        return im

    def _end_illustrative(self, cv: Canvas, im: Image.Image, y: float, box) -> float:
        bx0, by0, bx1, by1 = box
        bw = bx1 - bx0
        loc = self.ep.get("location")
        if loc and loc.get("name"):
            nb = fit(loc["name"], "sans", 650, bw, 1, 22, 16, what="location name")
            cv.lines(bx0, y, nb, rgba(C.MARKER_TEXT), box=box, what="location name")
            y += nb.height + 14
        if self.task == "precise_localization" and loc:
            # Only the answer the paper prints and its place; no per-round human result (the paper gives
            # only the 42-round average).
            mh = int(by1 - y)
            if mh < 160:
                raise Overflow(f"{self.id}: no room for the map")
            pts = [MapPoint(loc["lat"], loc["lng"], "location", loc["name"].split(",")[0])]
            self._place_map(cv, im, bx0, int(y), bw, mh, pts)
            y += mh
            return y
        # Place Naming / Navigation: the last annotated clue, cropped from its frame
        k = max((i for i, fr in enumerate(self.frames) if fr.get("clues")), default=None)
        if k is not None:
            avail = by1 - y - 48
            side = int(min(400, avail))
            if side < 140:
                raise Overflow(f"{self.id}: no room for the clue crop")
            crop = self.clue_crop(k, side)
            cv.paste(crop, (bx0, int(y)))
            notes = " · ".join(dict.fromkeys(n["text"] for n in self.frames[k].get("notes") or []))
            cap = f"Last annotated clue (frame {k + 1})" + (f": {notes}" if notes else "")
            cb = fit(cap, "sans", 500, bw, 2, self.L.end_small, self.L.end_small - 2, lh=1.3, what="clue caption")
            cv.lines(bx0, y + side + 6, cb, rgba(C.MUTED), box=box, what="clue caption")
            y += side + 6 + cb.height
        return y

    def _end_replay(self, cv: Canvas, im: Image.Image, y: float, box) -> float:
        bx0, by0, bx1, by1 = box
        bw = bx1 - bx0
        res = self.ep.get("result") or {}
        if self.task == "precise_localization":
            parts = []
            if res.get("score") is not None:
                parts.append(f"Score {res['score']:g}")
            if res.get("km") is not None:
                parts.append(f"{res['km']:g} km from the location")
            if parts:
                sb = fit(" · ".join(parts), "sans", 650, bw, 1, 22, 16, what="replay score")
                cv.lines(bx0, y, sb, rgba(C.MARKER_TEXT), box=box, what="replay score")
                y += sb.height + 10
            pts = []
            if res.get("truth"):
                pts.append(MapPoint(res["truth"][0], res["truth"][1], "truth", "location (rounded)"))
            if res.get("guess"):
                pts.append(MapPoint(res["guess"][0], res["guess"][1], "guess", "guess"))
            if pts:
                mh = int(by1 - y - 8)
                if mh < 160:
                    raise Overflow(f"{self.id}: no room for the map")
                self._place_map(cv, im, bx0, int(y), bw, mh, pts)
                y += mh + 10
            return y
        correct = res.get("correct")
        if correct is not None:
            col = C.GOOD if correct else C.BAD
            txt = "Correct" if correct else "Incorrect"
            f = font("sans", 22, 800)
            w = int(f.getlength(txt) + 56)
            pill = rrect(w, 40, 20, rgba(col, 0.16), outline=rgba(col, 1), width=1.5).copy()
            pd = ImageDraw.Draw(pill)
            cxm, cym = 22, 20
            if correct:
                pd.line([(cxm - 7, cym), (cxm - 2, cym + 5), (cxm + 7, cym - 6)], fill=rgba(col), width=3)
            else:
                pd.line([(cxm - 6, cym - 6), (cxm + 6, cym + 6)], fill=rgba(col), width=3)
                pd.line([(cxm - 6, cym + 6), (cxm + 6, cym - 6)], fill=rgba(col), width=3)
            Canvas(pill, safe=False).text((40, (40 + cap_h(f)) / 2), txt, f, rgba(col), box=(0, 0, w, 40), what="badge")
            if y + 40 > by1:
                raise Overflow("badge does not fit")
            cv.paste(pill, (bx0, int(y + 6)))
            self.strings.append(txt)
            y += 56
        ended = self.ep.get("ended")
        if ended in ("abstain", "step_limit", "error"):
            txt = {"abstain": "The model abstained.", "step_limit": "The episode ended at the step limit.",
                   "error": "The episode ended with an error."}[ended]
            eb = fit(txt, "sans", 450, bw, 2, 16, 13, lh=1.3, what="ended")
            cv.lines(bx0, y, eb, rgba(C.MUTED), box=box, what="ended")
            y += eb.height
        return y

    def _end_env(self, cv: Canvas, y: float, box) -> None:
        bx0, by0, bx1, by1 = box
        bw = bx1 - bx0
        groups: Dict[str, List[int]] = {}
        for i, img in enumerate(self.imgs):
            groups.setdefault(img.md5, []).append(i)
        reps = [g for g in groups.values() if len(g) > 1]
        reps.sort(key=lambda g: g[0])
        # (build_episodes.py checks that identical images come from the same camera state; the data
        # carries no poses, since the test logged none.)
        hb = fit("Same camera state, same image", "sans", 750, bw, 1, 32, 22, what="env head")
        cv.lines(bx0, y, hb, rgba(C.INK), box=box, what="env head")
        y += hb.height + 2
        sub = "Returning to a camera state returned the identical image:"
        sb = fit(sub, "sans", 450, bw, 2, 17, 14, lh=1.3, what="env sub")
        cv.lines(bx0, y, sb, rgba(C.INK, 0.85), box=box, what="env sub")
        y += sb.height + 14
        if reps:
            n = len(reps)
            cols = n if n <= 2 else 2 if n <= 4 else 4
            nrows = int(math.ceil(n / cols))
            gap, lab_h = 16, 26
            avail_h = by1 - y - 8 - 30 - 46          # leave room for the note (thumbnail size kept as before)
            th_max = avail_h / nrows - lab_h - 10
            tw = int(min((bw - gap * (cols - 1)) / cols, th_max * 16 / 9))
            th = int(tw * 9 / 16)
            for j, g in enumerate(reps):
                x = bx0 + (j % cols) * (tw + gap)
                yy = y + (j // cols) * (th + lab_h + 10)
                thumb = self.imgs[g[0]].src.resize((tw, th), Image.LANCZOS).convert("RGBA")
                cv.paste(round_mask(thumb, 6), (x, int(yy)))
                lab = "Steps " + " = ".join(str(i + 1) for i in g)
                lb = fit(lab, "mono", 600, tw, 1, 15, 11, what="env group")
                cv.lines(x, yy + th + 3, lb, rgba(C.INK), box=box, what="env group")
            y += nrows * (th + lab_h + 10) + 8
        # No place, coordinates or camera-grid line: the walkthrough is published without its place, and the
        # paper does not describe the wrapper's step sizes.
        nb = fit("Not a benchmark episode and not a model rollout: a scripted test of the offline environment.",
                 "sans", 450, bw, 2, 15, 12, lh=1.3, what="env note")
        if y + nb.height > by1:
            raise Overflow(f"{self.id}: walkthrough end card overflows")
        cv.lines(bx0, y, nb, rgba(C.MUTED), box=box, what="env note")

    def _place_map(self, cv: Canvas, im: Image.Image, x: int, y: int, w: int, h: int, pts: List[MapPoint]) -> None:
        mp, pos, grid_labels = render_map(w, h, pts)
        self.strings += grid_labels
        mp = round_mask(mp, 10)
        border = rrect(w, h, 10, (0, 0, 0, 0), outline=rgba(C.LINE), width=1.2)
        mp.alpha_composite(border)
        mcv = Canvas(mp, ox=x, oy=y)
        fl = font("sans", 14, 650)
        if len(pos) == 2 and pos[0][2].kind in ("truth", "guess"):
            (xa, ya, _), (xb, yb, _) = pos
            dist = math.hypot(xb - xa, yb - ya)
            dd = ImageDraw.Draw(mp)
            nseg = int(dist // 9)
            for s in range(0, nseg, 2):
                u0, u1 = s / max(1, nseg), min(1.0, (s + 1) / max(1, nseg))
                dd.line([(lerp(xa, xb, u0), lerp(ya, yb, u0)), (lerp(xa, xb, u1), lerp(ya, yb, u1))],
                        fill=rgba(C.INK, 0.8), width=2)
        for px, py, p in pos:
            col = C.MARKER if p.kind in ("location", "truth") else C.ACCENT_TEXT
            sp = dot(6.5, rgba(col), rgba(C.BG, 1), 2.5)
            mp.alpha_composite(sp, (int(round(px - sp.width / 2)), int(round(py - sp.height / 2))))
            lw = fl.getlength(p.label)
            lx = px + 18 if px + 18 + lw <= w - 8 else px - 18 - lw
            ly = py + cap_h(fl) / 2
            mcv.text((lx, ly), p.label, fl, rgba(C.INK), stroke=3, stroke_fill=rgba(C.BG),
                     box=(x, y, x + w, y + h), what="map label")
            self.end_markers.append((x + px, y + py, p.kind))
        cv.paste(mp, (x, y))
        self.strings += mcv.strings

    def clue_crop(self, k: int, side: int) -> Image.Image:
        fr = self.frames[k]
        img = self.imgs[k].src
        bx = [c["box"] for c in fr["clues"]]
        x0, y0 = min(b[0] for b in bx), min(b[1] for b in bx)
        x1, y1 = max(b[2] for b in bx), max(b[3] for b in bx)
        s = min(min(img.size), max(x1 - x0, y1 - y0) * 1.35 + 40)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        cx = min(max(cx, s / 2), img.width - s / 2)
        cy = min(max(cy, s / 2), img.height - s / 2)
        rx0, ry0 = cx - s / 2, cy - s / 2
        crop = img.crop((int(rx0), int(ry0), int(rx0 + s), int(ry0 + s))).resize((side, side), Image.LANCZOS).convert("RGBA")
        d = ImageDraw.Draw(crop)
        sc = side / int(s)
        for c in fr["clues"]:
            b = c["box"]
            q = [int(round((b[0] - int(rx0)) * sc)), int(round((b[1] - int(ry0)) * sc)),
                 int(round((b[2] - int(rx0)) * sc)), int(round((b[3] - int(ry0)) * sc))]
            q = [max(4, min(side - 5, v)) for v in q]
            d.rectangle((q[0] - 3, q[1] - 3, q[2] + 3, q[3] + 3), outline=rgba(C.WHITE), width=7)
            clue_outline(d, (q[0] - 1, q[1] - 1, q[2] + 1, q[3] + 1), rgba(C.CLUE[c["kind"]]), 3, c["kind"])
        return round_mask(crop, 8)

    def end_card_live(self, end_t: float) -> Image.Image:
        im = self.end_card()
        if not self.end_markers:
            return im
        out = im.copy()
        d = ImageDraw.Draw(out)
        for x, y, kind in self.end_markers:
            if kind not in ("location", "truth"):
                continue
            ph = (end_t % 1.6) / 1.6
            r = 9 + 22 * ease_out(ph)
            a = (1 - ph) * 0.85
            d.ellipse((x - r, y - r, x + r, y + r), outline=rgba(C.MARKER_TEXT, a), width=2)
        return out

    # ------------------------------------------------------- QA timestamps
    def poster_t(self) -> float:
        marked = [k for k in range(self.n) if self.frames[k].get("clues")]
        best = marked[-1] if marked else self.n // 2
        st = self.steps[best]
        return min(st.t_reveal1 + 0.4, st.t_hold1 - 0.1)

    def qa_times(self) -> List[Tuple[str, float]]:
        out = [("title", self.t_title1 * 0.6), ("open", self.t_title1 + 0.45 * (self.t_open1 - self.t_title1))]
        for st in self.steps[1:]:
            mid = (st.t_exec0 + st.t_arrive) / 2
            out.append((f"f{st.k + 1:02d}-transition", mid))
            out.append((f"f{st.k + 1:02d}-held", min(st.t_reveal1 + 0.3, st.t_hold1 - 0.05)))
        out.insert(2, ("f01-held", min(self.steps[0].t_reveal1 + 0.3, self.steps[0].t_hold1 - 0.05)))
        if self.first_calls:
            s0 = self.steps[0]
            out.insert(2, ("f01-transition", (s0.t_exec0 + s0.t_arrive) / 2))
        out.append(("end", self.t_close1 + 1.2))
        return out


def provenance_label(ep: dict) -> str:
    if ep["kind"] == "illustrative":
        return "Illustrative"
    if ep["kind"] == "env_tour":
        return "Environment walkthrough: renders from the offline environment"
    if ep["kind"] == "replay":
        m = ep.get("model") or {}
        return f"Replay: {m.get('name', '?')}, {m.get('run', '?')}"
    raise SystemExit(f"{ep.get('id')}: unknown kind {ep.get('kind')!r}")


def cover(im: Image.Image, w: int, h: int) -> Image.Image:
    s = max(w / im.width, h / im.height)
    r = im.resize((int(math.ceil(im.width * s)), int(math.ceil(im.height * s))), Image.LANCZOS)
    x, y = (r.width - w) // 2, (r.height - h) // 2
    return r.crop((x, y, x + w, y + h)).convert("RGB")


def alpha_mul(im: Image.Image, a: float) -> Image.Image:
    if a >= 0.999:
        return im
    out = im.copy()
    out.putalpha(out.getchannel("A").point(lambda v: int(v * a + 0.5)))
    return out


def fade_to_bg(im: Image.Image, f: float) -> Image.Image:
    if f <= 0:
        return im
    return Image.blend(im.convert("RGB"), Image.new("RGB", im.size, C.BG), min(1.0, f))

# =============================================================================
# Videos: single episode and hero montage
# =============================================================================


class Clip:
    """A renderable timeline: duration, state(t), render(state)."""

    def __init__(self, vid: str, parts: List[Episode]):
        self.id = vid
        self.parts = parts
        self.offsets = []
        t = 0.0
        for p in parts:
            self.offsets.append(t)
            t += p.T
        self.T = t
        self.nframes = int(round(self.T * FPS))

    def locate(self, t: float) -> Tuple[int, float]:
        for i in range(len(self.parts) - 1, -1, -1):
            if t >= self.offsets[i]:
                return i, t - self.offsets[i]
        return 0, t

    def state(self, t: float) -> dict:
        i, lt = self.locate(t)
        st = self.parts[i].state(min(lt, self.parts[i].T - 1e-6))
        st["part"] = i
        return st

    def render(self, st: dict) -> Image.Image:
        return self.parts[st["part"]].render(st)

    def chapters(self) -> List[dict]:
        out = []
        for p, off in zip(self.parts, self.offsets):
            lab = TASK_LABEL.get(p.task) if p.kind != "env_tour" else "Environment walkthrough"
            out.append({"id": p.id, "label": lab, "start": round(off, 2)})
        return out


def encode(clip: Clip, out_mp4: Path, crf: int) -> Dict[str, Any]:
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_mp4.with_name(out_mp4.stem + ".part.mp4")
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-an", "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,"
           "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv",
           "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-profile:v", "high", "-level:v", "4.0",
           "-g", str(FPS * 4), "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
           "-color_range", "tv", "-map_metadata", "-1", "-movflags", "+faststart", "-f", "mp4", str(tmp)]
    t0 = time.time()
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    last_key, last_bytes = None, b""
    unique = 0
    try:
        for i in range(clip.nframes):
            st = clip.state(i / FPS)
            key = json.dumps(st, sort_keys=True)
            if key != last_key:
                last_bytes = clip.render(st).tobytes()
                last_key = key
                unique += 1
            proc.stdin.write(last_bytes)
        proc.stdin.close()
    except BrokenPipeError:
        pass
    rc = proc.wait()
    if rc != 0:
        raise SystemExit(f"ffmpeg failed ({rc}) for {out_mp4}")
    cites = sorted({s for p in clip.parts for s in p.strings if CITATION_RE.search(s)})
    if cites:                                  # every frame is rendered by now, so every drawn string is listed
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"{out_mp4.name}: drawn text cites a part of the paper, which the page does not: {cites}")
    os.replace(tmp, out_mp4)
    return {"seconds": round(time.time() - t0, 1), "unique_frames": unique, "frames": clip.nframes,
            "bytes": out_mp4.stat().st_size}


def save_poster(clip: Clip, t: float, path: Path) -> None:
    im = clip.render(clip.state(t)).convert("RGB")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.stem + ".part.jpg")
    im.save(tmp, "JPEG", quality=86, optimize=True, progressive=True)
    os.replace(tmp, path)


def probe(path: Path) -> dict:
    out = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,nb_frames,color_space,"
                          "color_primaries,color_transfer,color_range:format=duration",
                          "-of", "json", str(path)], capture_output=True, text=True, check=True)
    j = json.loads(out.stdout)
    s = j["streams"][0]
    s["duration"] = float(j["format"]["duration"])
    a = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0",
                        str(path)], capture_output=True, text=True, check=True)
    s["audio_streams"] = len([ln for ln in a.stdout.splitlines() if ln.strip()])
    s["tags"] = container_tags(path)
    return s


def container_tags(path: Path) -> dict:
    """Format and stream tags, checked: ffmpeg's standard tags only, and no path, user name or episode id."""
    out = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format_tags:stream_tags", "-of", "json", str(path)],
                         capture_output=True, text=True, check=True)
    j = json.loads(out.stdout)
    tags = {"format": (j.get("format") or {}).get("tags") or {},
            "stream": [st.get("tags") or {} for st in j.get("streams") or []]}
    found = [("format", tags["format"])] + [("stream", t) for t in tags["stream"]]
    home = str(Path.home())
    for level, t in found:
        extra = set(t) - ALLOWED_TAGS[level]
        if extra:
            raise SystemExit(f"{path.name}: unexpected {level} tags {sorted(extra)}")
        for k, v in t.items():
            if "/" in v or "\\" in v or home in v or os.path.basename(home) in v or "geoguessr_" in v:
                raise SystemExit(f"{path.name}: {level} tag {k}={v!r} looks like a path, user name or entry id")
    data = path.read_bytes()        # the whole file, incl. the encoder's SEI text
    for needle in (home.encode(), os.path.basename(home).encode(), str(ROOT).encode(), b"geoguessr_"):
        if needle and needle in data:
            raise SystemExit(f"{path.name}: contains {needle!r}")
    return tags

# =============================================================================
# Data loading, jobs and CLI
# =============================================================================


def is_test_replay(ep: dict) -> bool:
    return ((ep.get("replay") or {}).get("server") == "stub"
            or str(ep.get("provenance", "")).startswith("PLUMBING TEST ONLY"))


def validate(ep: dict, frames_root: Path) -> None:
    need = ["id", "kind", "task", "title", "question", "answer", "aspect", "attribution", "provenance", "frames"]
    miss = [k for k in need if k not in ep]
    if miss:
        raise SystemExit(f"{ep.get('id')}: missing {miss}")
    if ep["aspect"] not in ("1:1", "16:9"):
        raise SystemExit(f"{ep['id']}: aspect {ep['aspect']!r}")
    if ep["attribution"] != ATTRIBUTION:
        raise SystemExit(f"{ep['id']}: attribution {ep['attribution']!r}")
    for fr in ep["frames"]:
        p = frames_root / fr["src"]
        if not p.exists():
            raise SystemExit(f"{ep['id']}: missing frame {p}")
        for c in fr.get("clues") or []:
            x0, y0, x1, y1 = c["box"]
            if not (0 <= x0 < x1 <= fr["w"] and 0 <= y0 < y1 <= fr["h"]):
                raise SystemExit(f"{ep['id']}: clue box {c['box']} outside {fr['src']}")
            if c["kind"] not in C.CLUE:
                raise SystemExit(f"{ep['id']}: clue kind {c['kind']!r}")


def read_step_budget() -> int:
    p = SITE / "assets" / "data" / "leaderboard.json"
    try:
        v = json.loads(p.read_text())["meta"]["step_budget"]
        return int(v)
    except Exception:
        log("warning: leaderboard.json meta.step_budget unavailable; using the benchmark's 40-step budget")
        return 40


def hero_clip(eps: Dict[str, dict], frames_root: Path, budget: int) -> Clip:
    k = 1.0
    for _ in range(12):
        parts = [Episode(eps[i], pace_scaled(HERO_TOUR if eps[i]["kind"] == "env_tour" else HERO, k), frames_root, budget)
                 for i in HERO_ORDER]
        clip = Clip("hero", parts)
        if clip.nframes / FPS <= HERO_MAX_S - 0.5:
            return clip
        k *= 0.9
    raise SystemExit(f"hero montage is {clip.T:.1f}s even with shortened holds (> {HERO_MAX_S}s)")


def episode_clip(ep: dict, frames_root: Path, budget: int) -> Clip:
    pace = FULL
    e = Episode(ep, pace, frames_root, budget)
    k = 1.0
    while e.T > 75.0 and k > 0.3:          # long replays: shorten holds so the clip stays small
        k *= 0.85
        e = Episode(ep, pace_scaled(FULL, k), frames_root, budget)
    return Clip(ep["id"], [e])


def run_job(job: dict) -> dict:
    """Render one video (runs in a worker process)."""
    frames_root = Path(job["frames_root"])
    out_dir = Path(job["out_dir"])
    budget = job["budget"]
    if job["id"] == "hero":
        clip = hero_clip(job["eps"], frames_root, budget)
        cap = HERO_CAP
        poster_t = 0.0      # the exact first frame, so the poster gives way to autoplay without a jump
    else:
        clip = episode_clip(job["ep"], frames_root, budget)
        cap = CLIP_CAP
        poster_t = clip.parts[0].poster_t()
    crf = job["crf"]
    mp4 = out_dir / f"{clip.id}.mp4"
    while True:
        info = encode(clip, mp4, crf)
        if info["bytes"] <= cap:
            break
        if crf >= 30:
            raise SystemExit(f"{mp4} is {info['bytes']} bytes > {cap} even at CRF {crf}")
        log(f"{clip.id}: {info['bytes']} bytes > {cap}; re-encoding at CRF {crf + 2}")
        crf += 2
    save_poster(clip, poster_t, out_dir / f"{clip.id}.jpg")
    pr = probe(mp4)
    qa = []
    for i, (p, off) in enumerate(zip(clip.parts, clip.offsets)):
        pre = f"{p.id}:" if len(clip.parts) > 1 else ""
        qa += [(pre + lab, round(off + t, 3)) for lab, t in p.qa_times()]
        if i > 0:                                   # chapter boundary (dip to the console colour)
            qa += [(pre + "chapter-in", round(off - 0.15, 3)), (pre + "chapter-start", round(off + 0.12, 3))]
    qa += [("loop-end", round(clip.T - 0.1, 3)), ("loop-start", 0.05)]
    qa.sort(key=lambda x: x[1])
    warnings = sorted({w for p in clip.parts for w in p.warnings})
    strings = list(dict.fromkeys(s for p in clip.parts for s in p.strings))
    return {"id": clip.id, "mp4": mp4.name, "poster": f"{clip.id}.jpg", "duration": round(pr["duration"], 2),
            "T": round(clip.T, 3), "frames": clip.nframes, "crf": crf, "bytes": info["bytes"],
            "poster_bytes": (out_dir / f"{clip.id}.jpg").stat().st_size, "render_s": info["seconds"],
            "unique_frames": info["unique_frames"], "probe": pr, "qa": qa, "poster_t": round(poster_t, 3),
            "chapters": clip.chapters() if clip.id == "hero" else None, "warnings": warnings, "strings": strings}


def write_videos_data(data_dir: Path, entries: Dict[str, dict]) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    body = json.dumps(entries, indent=1, ensure_ascii=True)
    (data_dir / "videos.json").write_text(body + "\n", encoding="utf-8")
    js = "window.GEOBENCH = window.GEOBENCH || {};\nwindow.GEOBENCH.videos = " + body + ";\n"
    (data_dir / "videos.js").write_text(js, encoding="utf-8")


def extract_stills(mp4: Path, qa: List[Tuple[str, float]], out: Path) -> List[str]:
    out.mkdir(parents=True, exist_ok=True)
    files = []
    for lab, t in qa:
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", lab)
        fn = out / f"{mp4.stem}__{t:07.3f}__{safe}.png"
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{t:.3f}", "-i", str(mp4),
                        "-frames:v", "1", str(fn)], check=True)
        files.append(str(fn))
    return files


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", action="append", default=[], help="render only this episode id (repeatable); no hero")
    ap.add_argument("--hero-only", action="store_true", help="render only the hero montage")
    ap.add_argument("--episodes", default=str(SITE / "assets" / "data" / "episodes.json"))
    ap.add_argument("--replays", default=str(SITE / "assets" / "data" / "replays.json"))
    ap.add_argument("--frames-root", default=str(SITE), help="base directory of the frames' src paths")
    ap.add_argument("--replay-frames-root", default=None, help="base directory for replay frames (default: --frames-root)")
    ap.add_argument("--out-dir", default=str(SITE / "assets" / "video"))
    ap.add_argument("--data-dir", default=str(SITE / "assets" / "data"))
    ap.add_argument("--no-data", action="store_true", help="do not write videos.{json,js}")
    ap.add_argument("--include-test-replays", action="store_true", help="also render replays marked as plumbing tests")
    ap.add_argument("--crf", type=int, default=DEFAULT_CRF)
    ap.add_argument("--jobs", type=int, default=min(5, os.cpu_count() or 1))
    ap.add_argument("--qa-dir", default=None, help="extract QA stills (PNG) with ffmpeg into this directory")
    ap.add_argument("--still", action="append", default=[], help="ID@T[,T...]: write uncompressed PNG stills (no encode)")
    ap.add_argument("--report-json", default=None, help="write per-video render info (sizes, QA times, strings) here")
    args = ap.parse_args(argv)

    frames_root = Path(args.frames_root).resolve()
    replay_root = Path(args.replay_frames_root).resolve() if args.replay_frames_root else frames_root
    out_dir = Path(args.out_dir).resolve()
    data_dir = Path(args.data_dir).resolve()
    budget = read_step_budget()
    episodes = json.loads(Path(args.episodes).read_text(encoding="utf-8"))
    replays = json.loads(Path(args.replays).read_text(encoding="utf-8")) if Path(args.replays).exists() else []
    ids = [e["id"] for e in episodes]
    if tuple(ids[:4]) != FIXED_IDS:
        raise SystemExit(f"episodes.json must start with {FIXED_IDS}, got {ids}")
    kept_replays = []
    for r in replays:
        if r.get("kind") != "replay" or r["id"] in FIXED_IDS:
            raise SystemExit(f"replay {r.get('id')}: bad kind or id")
        if is_test_replay(r) and not args.include_test_replays:
            log(f"skipping plumbing-test replay {r['id']}")
            continue
        kept_replays.append(r)
    all_eps = episodes + kept_replays
    by_id = {e["id"]: e for e in all_eps}
    if len(by_id) != len(all_eps):
        raise SystemExit("duplicate episode ids")
    roots = {e["id"]: (replay_root if e["kind"] == "replay" else frames_root) for e in all_eps}
    for e in all_eps:
        validate(e, roots[e["id"]])

    if args.still:
        sdir = Path(args.qa_dir or ".").resolve()
        sdir.mkdir(parents=True, exist_ok=True)
        for spec in args.still:
            vid, ts = spec.split("@")
            clip = hero_clip(by_id, frames_root, budget) if vid == "hero" else episode_clip(by_id[vid], roots[vid], budget)
            for tt in ts.split(","):
                t = float(tt)
                im = clip.render(clip.state(t))
                fn = sdir / f"still_{vid}_{t:07.3f}.png"
                im.save(fn)
                print(fn)
            for p in clip.parts:
                for w in p.warnings:
                    log("warning: " + w)
            print(f"{vid}: T={clip.T:.2f}s, qa={[(a, round(b, 2)) for a, b in clip.parts[0].qa_times()]}")
        return 0

    if args.hero_only and args.only:
        raise SystemExit("--only and --hero-only are exclusive")
    if args.hero_only:
        targets = ["hero"]
    elif args.only:
        for i in args.only:
            if i not in by_id:
                raise SystemExit(f"unknown episode id {i!r} (known: {sorted(by_id)})")
        targets = list(dict.fromkeys(args.only))
    else:
        targets = [e["id"] for e in all_eps] + ["hero"]
    jobs = []
    for tid in targets:
        job = {"id": tid, "frames_root": str(roots.get(tid, frames_root)), "out_dir": str(out_dir), "budget": budget,
               "crf": args.crf}
        if tid == "hero":
            job["eps"] = {i: by_id[i] for i in HERO_ORDER}
        else:
            job["ep"] = by_id[tid]
        jobs.append(job)
    results: Dict[str, dict] = {}
    t0 = time.time()
    if args.jobs > 1 and len(jobs) > 1:
        with ProcessPoolExecutor(max_workers=min(args.jobs, len(jobs))) as ex:
            for res in ex.map(run_job, jobs):
                results[res["id"]] = res
                log(f"{res['id']}: {res['duration']:.2f}s, {res['bytes'] / 1e6:.2f} MB (CRF {res['crf']}), "
                    f"render {res['render_s']}s")
    else:
        for job in jobs:
            res = run_job(job)
            results[res["id"]] = res
            log(f"{res['id']}: {res['duration']:.2f}s, {res['bytes'] / 1e6:.2f} MB (CRF {res['crf']}), render {res['render_s']}s")
    for res in results.values():
        for w in res["warnings"]:
            log(f"warning: {w}")
        pr = res["probe"]
        assert pr["width"] == W and pr["height"] == H and pr["codec_name"] == "h264" and pr["pix_fmt"] == "yuv420p", pr
        assert pr["r_frame_rate"] == f"{FPS}/1" and pr["audio_streams"] == 0, pr
        assert (pr.get("color_space"), pr.get("color_primaries"), pr.get("color_transfer")) == ("bt709",) * 3, pr
        cap = HERO_CAP if res["id"] == "hero" else CLIP_CAP
        assert res["bytes"] <= cap, res
        if res["id"] == "hero":
            assert res["duration"] <= HERO_MAX_S, res

    rel = os.path.relpath(out_dir, SITE).replace(os.sep, "/")
    if not args.no_data:
        path = data_dir / "videos.json"
        entries: Dict[str, dict] = {}
        if (args.only or args.hero_only) and path.exists():
            entries = json.loads(path.read_text(encoding="utf-8"))
        for vid, res in results.items():
            e = {"mp4": f"{rel}/{res['mp4']}", "poster": f"{rel}/{res['poster']}", "duration": res["duration"],
                 "width": W, "height": H}
            if vid == "hero":
                e["chapters"] = res["chapters"]
            entries[vid] = e
        order = ["hero"] + [e["id"] for e in all_eps]
        entries = {k: entries[k] for k in order if k in entries} | {k: v for k, v in entries.items() if k not in order}
        write_videos_data(data_dir, entries)
        log(f"wrote {data_dir / 'videos.json'} and videos.js ({len(entries)} entries)")
        if not (args.only or args.hero_only):
            # A full run rebuilds the index, so files it no longer lists (e.g. after an episode id was renamed)
            # would only be deployed as dead weight.
            listed = {Path(v[k]).name for v in entries.values() for k in ("mp4", "poster")}
            for p in sorted(out_dir.iterdir()):
                if p.suffix in (".mp4", ".jpg") and p.name not in listed and re.fullmatch(r"[a-z0-9][a-z0-9.-]*", p.stem):
                    p.unlink()
                    log(f"removed stale {p.name} (not listed in videos.json)")
    if args.qa_dir:
        qd = Path(args.qa_dir).resolve()
        for vid, res in results.items():
            files = extract_stills(out_dir / res["mp4"], res["qa"], qd)
            res["stills"] = files
    if args.report_json:
        Path(args.report_json).write_text(json.dumps(results, indent=1, ensure_ascii=False))
    log(f"done in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())

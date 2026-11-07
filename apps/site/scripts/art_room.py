#!/usr/bin/env python3
"""Draws the room's objects as the text maps a post can name (ADR 0027): `just art-room`.

The numbers are scene.py's, in its 480x160 pixels, each shape given a tone. The scene's PNGs are
60 pixels across at best and dithered, so sampling them gives noise; the geometry scales. The
record player and the window are written straight onto the lattice: sampled, the record's platter,
arm and plinth merge into bars, and the skyline turns into a guess.
"""
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from art_map import COLS, ROWS, canvas, stamp, to_map, write

OUT = Path(__file__).resolve().parent.parent / 'src' / 'art'
S = 12  # scene pixel -> source pixels


class Sheet:
    def __init__(self, box):
        self.x0, self.y0, x1, y1 = box
        self.size = ((x1 - self.x0) * S, (y1 - self.y0) * S)
        self.g = Image.new('L', self.size, 0)
        self.m = Image.new('L', self.size, 0)
        self.a = Image.new('L', self.size, 0)
        self.dg, self.dm, self.da = (ImageDraw.Draw(i) for i in (self.g, self.m, self.a))

    def pts(self, p):
        return [((x - self.x0) * S, (y - self.y0) * S) for x, y in p]

    def _each(self, fn, tone, accent, cut):
        fn(self.dg, int(tone * 255))
        fn(self.dm, 0 if cut else 255)
        fn(self.da, 255 if accent else 0)

    def poly(self, p, tone, accent=False, cut=False):
        q = self.pts(p)
        self._each(lambda d, f: d.polygon(q, fill=f), tone, accent, cut)

    def rect(self, x0, y0, x1, y1, tone, accent=False, cut=False):
        self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], tone, accent, cut)

    def ell(self, x0, y0, x1, y1, tone, accent=False, cut=False):
        q = self.pts([(x0, y0), (x1, y1)])
        self._each(lambda d, f: d.ellipse(q, fill=f), tone, accent, cut)

    def line(self, p, w, tone, accent=False):
        q = self.pts(p)
        self._each(lambda d, f: d.line(q, fill=f, width=int(w * S), joint='curve'), tone, accent, False)

    def out(self):
        f = lambda i: np.asarray(i).astype(float) / 255
        return f(self.g), f(self.m) > .5, f(self.a)


def lamp():
    s = Sheet((96, 64, 164, 136))
    s.ell(134, 126, 158, 133, .35)                                       # foot
    s.ell(136, 125, 156, 131, .7)
    s.line([(145, 127), (142, 106), (138, 92), (124, 80)], 2.4, .75)     # arm
    s.poly([(104, 74), (126, 70), (132, 84), (100, 90)], .5)             # shade
    s.poly([(104, 74), (126, 70), (127, 73), (106, 77)], .95)
    s.ell(108, 88, 124, 94, 1, accent=True)                              # bulb
    return s.out()


def notebook():
    s = Sheet((26, 64, 164, 136))
    s.poly([(34, 114), (80, 112), (80, 130), (30, 131)], .85)
    s.poly([(80, 112), (126, 114), (131, 131), (80, 130)], .95)
    s.rect(79, 112, 82, 131, .3)
    for k in range(5):
        ly = 116 + k * 3
        s.rect(37 + k // 2, ly, 76 - (k % 2) * 12, ly + 1.4, .1)
        s.rect(86, ly + 1, 120 - (k % 3) * 8, ly + 2.4, .1)
    s.line([(98, 128), (126, 121)], 1.6, 1, accent=True)                 # pencil
    s.ell(134, 126, 158, 133, .35)
    s.ell(136, 125, 156, 131, .7)
    s.line([(145, 127), (142, 106), (138, 92), (124, 80)], 2.2, .75)
    s.poly([(104, 74), (126, 70), (132, 84), (100, 90)], .4)
    s.poly([(104, 74), (126, 70), (127, 73), (106, 77)], .95)
    s.ell(108, 88, 124, 94, 1, accent=True)
    return s.out()


def monitor():
    s = Sheet((168, 38, 272, 113))
    s.rect(172, 40, 268, 101, .25)
    s.rect(172, 40, 268, 42, .6)
    s.rect(177, 45, 263, 96, .02)
    s.rect(177, 45, 195, 96, .08)
    mr = random.Random(3)   # the seed of scene.py, so the screen shows the room's own code
    for i in range(6):
        s.rect(180, 49 + i * 5, 180 + mr.randint(6, 12), 50.6 + i * 5, 1)
    for i in range(9):
        x = 199 + (0, 4, 4, 8, 8, 4, 4, 0, 0)[i]
        for _ in range(mr.randint(2, 4)):
            w = mr.randint(4, 14)
            amber = mr.choice((0, 1, 0, 0))
            s.rect(x, 49 + i * 5, min(x + w, 258), 50.6 + i * 5, 1, accent=bool(amber) and i == 3)
            x += w + 3
            if x > 250:
                break
    s.rect(177, 90, 263, 96, .55)
    s.rect(216, 101, 224, 108, .3)
    s.rect(202, 107, 238, 111, .4)
    return s.out()


def cat():
    """The scene's cat, its 24 pixels kept in proportion: curled, head on the near side, tail
    along the front. A thin cut separates head from body, which at this size is all that does."""
    s = Sheet((60, 74, 90, 92))
    s.ell(62, 81, 80, 90, .7)
    s.rect(62, 88, 77, 89.6, .95)                                        # tail along the front
    for x, y in ((65, 83), (68, 82.4), (71, 82.4), (66.5, 85.4), (70, 85)):
        s.rect(x, y, x + 1.3, y + 2, .2)
    s.ell(74.4, 78.6, 86.6, 88.6, 0, cut=True)                           # the gap round the head
    s.ell(75, 79, 86, 88, .9)
    s.poly([(76, 81), (77, 75.4), (80.4, 79.6)], .95)
    s.poly([(81.6, 79.6), (85, 75.4), (86, 81.6)], .95)
    for x0 in (77.6, 81.8):                                              # shut eyes
        s.rect(x0, 83.6, x0 + 2.2, 84.3, .02)
    s.rect(80.6, 85.4, 81.2, 86, .02)
    return s.out()


def tea():
    s = Sheet((270, 90, 324, 133))
    s.ell(272, 122, 322, 131, .75)
    s.ell(274, 123, 320, 129, .35)
    s.rect(280, 112, 288, 124, .9)
    s.rect(281, 115, 287, 124, .5, accent=True)
    s.rect(280, 112, 288, 113, 1)
    for lx, ly in ((279, 104), (282, 102), (285, 105), (281, 108), (286, 109), (283, 106)):
        s.rect(lx, ly, lx + 3, ly + 3, .7)
    s.ell(292, 108, 314, 125, .7)
    s.poly([(298, 100), (306, 100), (309, 110), (295, 110)], .7)
    s.ell(298, 95, 307, 102, .4)
    s.rect(302, 92, 304, 96, .7)
    s.poly([(311, 114), (318, 100), (320, 101), (313, 119)], .7)
    s.line([(292, 106), (288, 108), (288, 117), (293, 120)], 2, .4)
    s.rect(294, 112, 296, 121, 1)
    s.rect(296, 116, 312, 117, .35)
    return s.out()


def record():
    """The platter from a little higher than the scene, so the disc is a disc: empty vinyl with a
    bright rim and grooves, the label in the accent, the arm over it, the plinth in shade."""
    grid = canvas()
    cx, cy, rx, ry = 66, 14.5, 36, 12
    for j in range(2, 28):
        inset = (27 - j) * .35
        for i in range(round(18 + inset), round(126 - inset)):
            grid[j][i] = '.'
    for i in range(18, 126):
        grid[26][i] = grid[27][i] = '#'
    for j in range(ROWS):
        for i in range(COLS):
            t = math.hypot((i - cx) / rx, (j - cy) / ry)
            if t > 1.02:
                continue
            grid[j][i] = '#' if t > .9 else '+' if t < .3 else '#' if .6 < t < .68 else ' '
    grid[round(cy)][cx] = grid[round(cy)][cx + 1] = ' '
    for k in range(29):
        x, y = 112 - k, 5 + k * .4
        for dy in (0, 1):
            grid[round(y) + dy][round(x)] = '#'
    for j in range(2, 9):
        for i in range(107, 118):
            if math.hypot((i - 112) / 5.5, (j - 5) / 3.4) < 1:
                grid[j][i] = '#'
    for j in range(17, 20):
        for i in range(83, 88):
            grid[j][i] = '#'
    return grid


def window():
    """The arch with the skyline as the bright mass, the scene's silhouettes, and its lit windows
    in the accent. Each scene pixel lands on the cell under it."""
    grid = canvas()
    scale, left, top = 1 / 3.1, 66, 0  # scene pixels to rows; cells are 1.6 times narrower
    cx, cy, rad = 104, 48, 40

    def inside(x, y, r):
        return abs(x - cx) <= r and y < 90 if y >= cy else math.hypot(x - cx, y - cy) <= r

    def box(x, y, *rects):
        return any(x0 <= x < x1 and y0 <= y < y1 for x0, y0, x1, y1 in rects)

    skyline = ((64, 82, 144, 92), (66, 76, 80, 84), (82, 72, 96, 84), (98, 78, 110, 84),
               (132, 74, 144, 84), (112, 50, 129, 84), (89, 60, 91, 67), (70, 66, 72, 82))
    for j in range(ROWS):
        for i in range(COLS):
            x = cx + (i - left - 21) / scale / 1.6
            y = (j - top + .5) / scale
            if not inside(x, y, rad + 2):
                continue
            dome = math.hypot(x - 90, y - 72) < 7
            grid[j][i] = ('#' if not inside(x, y, rad - 2) or box(x, y, *skyline) or dome else
                          '.' if (i + j) % 2 == 0 else ' ')
    for sx, sy in ((78, 22), (92, 14), (118, 18), (130, 30), (84, 40), (110, 28), (72, 52), (136, 46), (100, 12)):
        grid[round(sy * scale)][round(left + 21 + (sx - cx) * scale * 1.6)] = '#'
    for wx, wy in ((69, 79), (86, 76), (102, 81), (136, 78), (120, 62), (120, 70)):
        grid[round(wy * scale)][round(left + 21 + (wx - cx) * scale * 1.6)] = '+'
    return grid


SAMPLED = dict(lamp=(lamp, dict(mix=.4, relief=.3, top=50), 28), notebook=(notebook, dict(mix=.3, relief=.1, top=55), 28),
               monitor=(monitor, dict(mix=.2, relief=0, top=22), 28), cat=(cat, dict(mix=.3, relief=.35, top=55), 24),
               tea=(tea, dict(mix=.3, relief=.3, top=50), 28))

for name, (draw, options, rows) in SAMPLED.items():
    gray, mask, accent = draw()
    figure = to_map(gray, mask, rows=rows, accent=accent, blur=.6, **options)
    write(OUT / f'{name}.txt', stamp(canvas(), figure, .6))
write(OUT / 'record.txt', record())
write(OUT / 'window.txt', window())

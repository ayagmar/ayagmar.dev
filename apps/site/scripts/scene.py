#!/usr/bin/env python3
"""Draws the home page room (ADR 0026) as two 480x160 dithered pixel-art PNGs.

`room-night.png` is the desk at night, lit by the lamp, the monitor and the fairy lights;
`room-day.png` is the same desk in daylight with the lamp off. Everything is geometry plus an
ordered (Bayer) dither onto a fixed palette; no photo or portrait is involved.

The room details (ADR 0027) add four layers the home page script picks by Casablanca time:
`window-{day,dusk,night}.png`, only the view through the window on a transparent scene, and
`room-night-dim.png`, the night room with the lamp turned down between 02:00 and 07:00. The
moon is not drawn here: the script draws the real phase over the window.
Run `just scene`; the outputs in src/assets/ are committed.

The hotspot rectangles over the scene live in src/styles/room.css, in percentages of these
480x160 pixels; move them there when an object moves here.
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).resolve().parent.parent / "src" / "assets"


def draw(DAY: bool, sky: str | None = None, lamp: float = 1.0) -> tuple[Image.Image, Image.Image]:
    """The room in daylight or at night, and the mask of the view through the window that
    nothing in the room covers. `sky` is that view (day, dusk or night, the theme's own by
    default) and `lamp` scales the desk lamp's light."""
    sky = sky or ("day" if DAY else "night")
    W, H = 480, 160
    rnd = random.Random(7)

    A = Image.new("RGB", (W, H), (0, 0, 0))   # albedo
    E = Image.new("L", (W, H), 0)             # emissive mask (255 = self-lit)
    V = Image.new("L", (W, H), 0)             # the view through the window (255), see draw()
    da, de, dv = ImageDraw.Draw(A), ImageDraw.Draw(E), ImageDraw.Draw(V)
    view = [False]                            # whether shapes drawn now are the view


    def R(x0, y0, x1, y1, col, em=False):
        da.rectangle([x0, y0, x1 - 1, y1 - 1], fill=col)
        de.rectangle([x0, y0, x1 - 1, y1 - 1], fill=255 if em else 0)
        dv.rectangle([x0, y0, x1 - 1, y1 - 1], fill=255 if view[0] else 0)


    def P(x, y, col, em=False):
        if 0 <= x < W and 0 <= y < H:
            A.putpixel((x, y), col)
            E.putpixel((x, y), 255 if em else 0)
            V.putpixel((x, y), 255 if view[0] else 0)


    def POLY(pts, col, em=False):
        da.polygon(pts, fill=col)
        de.polygon(pts, fill=255 if em else 0)
        dv.polygon(pts, fill=255 if view[0] else 0)


    def ELL(x0, y0, x1, y1, col, em=False):
        da.ellipse([x0, y0, x1 - 1, y1 - 1], fill=col)
        de.ellipse([x0, y0, x1 - 1, y1 - 1], fill=255 if em else 0)
        dv.ellipse([x0, y0, x1 - 1, y1 - 1], fill=255 if view[0] else 0)


    def LINE(pts, col, width=1, em=False):
        da.line(pts, fill=col, width=width)
        de.line(pts, fill=255 if em else 0, width=width)
        dv.line(pts, fill=255 if view[0] else 0, width=width)


    # ---------------------------------------------------------------- materials
    PLASTER = (122, 100, 130)
    WOOD = (150, 100, 62)
    WOOD_D = (96, 60, 38)
    WOOD_DD = (62, 38, 28)
    BRASS = (214, 170, 70)
    BRASS_D = (150, 110, 40)
    PAPER = (232, 218, 182)
    MINT = (110, 214, 170)
    MINT_M = (46, 140, 110)
    MINT_D = (24, 84, 74)
    AMBER = (250, 196, 104)
    INK = (60, 50, 84)

    # ------------------------------------------------------------------- wall
    wall = (206, 176, 146) if DAY else PLASTER  # sunlit sand plaster by day
    R(0, 0, W, 108, wall)
    for y in range(0, 108):
        for x in range(0, W):
            n = rnd.randint(-7, 7)
            r, g, b = wall
            A.putpixel((x, y), (r + n, g + n, b + n))

    # zellige band behind the desk
    R(0, 93, W, 95, BRASS_D)
    for ty in range(2):
        for tx in range(0, W // 7 + 1):
            x0, y0 = tx * 7, 95 + ty * 7
            blue = (tx + ty) % 2 == 0
            R(x0, y0, x0 + 6, y0 + 6, (40, 70, 130) if blue else MINT_D)
            R(x0 + 6, y0, x0 + 7, y0 + 7, (196, 184, 150))
            R(x0, y0 + 6, x0 + 7, y0 + 7, (196, 184, 150))
            cx, cy = x0 + 3, y0 + 3
            for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
                P(cx + dx, cy + dy, (232, 218, 182) if blue else (110, 214, 170))

    # ---------------------------------------------------------------- window
    CX, CY, RAD = 104, 48, 40


    def in_arch(x, y, r):
        if y >= CY:
            return abs(x - CX) <= r and y < 90
        return (x - CX) ** 2 + (y - CY) ** 2 <= r * r


    for y in range(0, 94):
        for x in range(55, 155):
            if in_arch(x, y, RAD + 4) and not in_arch(x, y, RAD):
                P(x, y, (178, 164, 170))
    # sky: from here to the mullions, everything drawn is the view
    view[0] = True
    SKY = {
        "day": [(110, 168, 222), (136, 186, 230), (164, 204, 236), (196, 222, 238), (214, 226, 232), (222, 222, 214)],
        "dusk": [(30, 34, 68), (52, 44, 96), (104, 62, 98), (168, 92, 90), (222, 150, 78), (250, 196, 104)],
        "night": [(8, 10, 34), (14, 18, 52), (26, 28, 72), (52, 44, 96), (104, 62, 98), (168, 92, 90)],
    }[sky]
    for y in range(0, 90):
        for x in range(CX - RAD, CX + RAD + 1):
            if in_arch(x, y, RAD):
                t = max(0, min(1, (y - 6) / 82))
                i = t * (len(SKY) - 1)
                a, b = SKY[int(i)], SKY[min(len(SKY) - 1, int(i) + 1)]
                f = i - int(i)
                P(x, y, tuple(int(a[k] + (b[k] - a[k]) * f) for k in range(3)), True)
    if sky == "day":
        # two small clouds
        for cx0, cy0, cw in ((70, 24, 16), (114, 16, 20)):
            ELL(cx0, cy0, cx0 + cw, cy0 + 6, (246, 246, 242), True)
            ELL(cx0 + 4, cy0 - 3, cx0 + cw - 4, cy0 + 4, (250, 250, 248), True)
    else:
        # stars; at dusk only the brightest
        for sx, sy in ((78, 22), (92, 14), (118, 18), (130, 30), (84, 40), (110, 28), (72, 52), (136, 46), (100, 10)):
            if in_arch(sx, sy, RAD - 1) and (sky == "night" or sy < 16):
                P(sx, sy, (226, 230, 255), True)
    # skyline (rooftops, a minaret, a dome, a palm): whitewashed walls by day, silhouettes by night
    SIL = (232, 222, 204) if sky == "day" else (8, 9, 22)
    SIL_D = (196, 176, 150) if sky == "day" else SIL
    R(64, 82, 144, 90, SIL, True)
    R(66, 76, 80, 84, SIL, True)
    R(82, 72, 96, 84, SIL, True)
    R(98, 78, 110, 84, SIL, True)
    R(132, 74, 144, 84, SIL, True)
    ELL(84, 66, 96, 78, SIL, True)                       # small dome
    R(89, 62, 91, 67, SIL, True)
    R(116, 54, 124, 84, SIL_D, True)                      # minaret shaft
    R(115, 52, 125, 55, SIL_D, True)
    R(117, 47, 123, 52, SIL_D, True)
    R(119, 42, 121, 47, SIL_D, True)
    P(120, 40, SIL_D, True)
    R(117, 62, 123, 63, (46, 140, 110) if sky == "day" else (26, 28, 72), True)  # shaft band
    lit = (96, 80, 90) if sky == "day" else AMBER
    for wx, wy in ((69, 79), (86, 76), (102, 81), (136, 78), (120, 70), (120, 76)):
        P(wx, wy, lit, True)
    P(120, 57, lit, True)
    # palm
    PALM = (52, 96, 62) if sky == "day" else SIL
    R(70, 66, 72, 82, (110, 80, 50) if sky == "day" else SIL, True)
    for ex, ey in ((60, 64), (66, 60), (78, 60), (84, 64), (64, 70), (80, 70)):
        LINE([(71, 66), (ex, ey)], PALM, 1, True)
    view[0] = False
    # mullions + sill
    R(CX - 1, 8, CX + 1, 90, (178, 164, 170))
    R(57 + 7, 58, 144, 60, (178, 164, 170))
    R(58, 90, 150, 94, (196, 184, 160))
    R(58, 94, 150, 95, WOOD_D)

    # -------------------------------------------------------- fairy lights
    pts = []
    for x in range(150, 372):
        t = (x - 150) / 222
        pts.append((x, int(5 + 6 * math.sin(math.pi * t))))
    LINE(pts, (46, 36, 50), 1)
    BULBS = []
    for x in range(160, 372, 15):
        t = (x - 150) / 222
        y = int(5 + 6 * math.sin(math.pi * t)) + 2
        P(x, y, (232, 226, 210) if DAY else (255, 232, 168), not DAY)
        P(x, y + 1, (200, 190, 170) if DAY else AMBER, not DAY)
        BULBS.append((x, y))

    # --------------------------------------------------------------- shelf
    SX0, SX1, SY0, SY1 = 366, 470, 6, 94
    R(SX0, SY0, SX1, SY1, WOOD_DD)
    for bx in (SX0, SX1 - 3):
        R(bx, SY0, bx + 3, SY1, WOOD_D)
    BOARDS = (30, 58, 86)
    for by in BOARDS:
        R(SX0, by, SX1, by + 3, WOOD_D)
    R(SX0, SY0, SX1, SY0 + 3, WOOD_D)
    R(SX0 - 2, SY1, SX1 + 2, SY1 + 3, WOOD_D)

    SPINE = [(190, 64, 56), (40, 70, 130), (232, 218, 182), (214, 170, 70), (46, 140, 110),
             (122, 82, 140), (80, 120, 190), (176, 104, 70), (210, 214, 230), (36, 40, 70)]


    def books(x0, x1, ybot, hmin, hmax, seed, series=None):
        r = random.Random(seed)
        x = x0
        while x < x1 - 3:
            w = r.randint(3, 6)
            if x + w > x1:
                w = x1 - x
            h = r.randint(hmin, hmax)
            col = r.choice(SPINE) if series is None else series
            R(x, ybot - h, x + w, ybot, col)
            R(x, ybot - h, x + 1, ybot, tuple(min(255, c + 36) for c in col))
            if r.random() < 0.6:
                sy = ybot - h + r.randint(3, max(3, h - 6))
                R(x + 1, sy, x + w - 1, sy + 2, tuple(max(0, c - 70) for c in col))
            if r.random() < 0.15:
                x += r.randint(2, 5)  # a gap
            x += w


    # top row: a short manga run then a plant
    books(SX0 + 3, SX1 - 30, BOARDS[0], 15, 20, 11)
    # plant (mint) top right
    R(SX1 - 24, BOARDS[0] - 8, SX1 - 14, BOARDS[0], (176, 104, 70))
    for lx, ly in ((SX1 - 22, 14), (SX1 - 18, 10), (SX1 - 15, 16), (SX1 - 25, 18), (SX1 - 12, 20), (SX1 - 19, 18)):
        R(lx, ly, lx + 3, ly + 3, MINT_M)
        P(lx + 1, ly + 1, MINT)
    # middle row: uniform manga run (same height, red/white alternating), then a flat stack
    x = SX0 + 3
    for i in range(14):
        col = (232, 218, 182) if i % 2 == 0 else (190, 64, 56)
        R(x, BOARDS[1] - 22, x + 4, BOARDS[1], col)
        R(x, BOARDS[1] - 22, x + 1, BOARDS[1], tuple(min(255, c + 30) for c in col))
        R(x + 1, BOARDS[1] - 17, x + 3, BOARDS[1] - 12, (36, 40, 70))
        x += 5
    books(x + 3, SX1 - 36, BOARDS[1], 18, 23, 21)
    R(SX1 - 34, BOARDS[1] - 4, SX1 - 6, BOARDS[1], (40, 70, 130))
    R(SX1 - 32, BOARDS[1] - 8, SX1 - 8, BOARDS[1] - 4, (214, 170, 70))
    R(SX1 - 30, BOARDS[1] - 12, SX1 - 10, BOARDS[1] - 8, (190, 64, 56))
    # bottom row: novels, a few light novels
    books(SX0 + 3, SX1 - 3, BOARDS[2], 17, 23, 31)

    # ---------------------------------------------------------- corkboard
    R(8, 12, 58, 52, WOOD_D)
    R(10, 14, 56, 50, (150, 104, 66))
    for _ in range(120):
        P(rnd.randint(10, 55), rnd.randint(14, 49), (126, 86, 54))
    for nx, ny, nw, nh, col in ((13, 17, 13, 11, (232, 218, 182)), (30, 16, 12, 14, (250, 200, 110)),
                                (44, 19, 10, 9, (190, 220, 200)), (14, 32, 11, 12, (240, 160, 150)),
                                (28, 34, 14, 10, (232, 218, 182)), (45, 32, 9, 13, (250, 200, 110))):
        R(nx, ny, nx + nw, ny + nh, col)
        for ly in range(ny + 3, ny + nh - 1, 3):
            R(nx + 2, ly, nx + nw - 2 - rnd.randint(0, 3), ly + 1, INK)
        P(nx + nw // 2, ny, (190, 64, 56))
    # string between two notes
    LINE([(25, 23), (36, 24), (49, 28)], (190, 64, 56), 1)

    # ------------------------------------------ framed little screen (usage)
    R(8, 58, 58, 102, BRASS_D)
    R(10, 60, 56, 100, (20, 22, 40), True)
    LV = [(22, 26, 48), MINT_D, MINT_M, MINT, (190, 246, 220)]
    hr = random.Random(5)
    for cx in range(11):
        for cy in range(7):
            lv = min(4, max(0, int(hr.random() * 3 + (cx / 11) * 1.6 - 0.4 + (1 if cy in (1, 2, 3) else 0) * 0.5)))
            R(12 + cx * 4, 66 + cy * 4, 12 + cx * 4 + 3, 66 + cy * 4 + 3, LV[lv], True)
    R(12, 94, 40, 96, MINT_M, True)

    # ------------------------------------------------------------- desk
    R(0, 108, W, 134, WOOD)
    for y in range(108, 134):
        for x in range(W):
            if (y * 7 + x // 11) % 5 == 0 and rnd.random() < 0.55:
                P(x, y, tuple(c - 14 for c in WOOD))
    R(0, 108, W, 111, tuple(c - 40 for c in WOOD))          # shadow at the wall
    R(0, 132, W, 136, (186, 130, 82))                          # front edge highlight
    R(0, 136, W, H, WOOD_DD)
    for dx in (30, 180, 330):
        R(dx, 140, dx + 120, 156, WOOD_D)
        R(dx + 2, 142, dx + 118, 154, (74, 46, 32))
        R(dx + 56, 146, dx + 64, 148, BRASS)

    # ------------------------------------------------------------ notebook
    POLY([(34, 114), (80, 112), (80, 130), (30, 131)], PAPER)
    POLY([(80, 112), (126, 114), (131, 131), (80, 130)], (224, 210, 172))
    R(79, 112, 82, 131, (150, 138, 112))
    for k in range(5):
        ly = 116 + k * 3
        R(37 + k // 2, ly, 76, ly + 1, (170, 190, 220))
        R(86, ly + 1, 120 - (k % 3) * 4, ly + 2, (170, 190, 220))
    R(40, 117, 60, 118, INK)
    R(40, 120, 70, 121, INK)
    R(40, 123, 54, 124, INK)
    R(88, 118, 112, 119, INK)
    R(88, 121, 104, 122, INK)
    R(88, 124, 116, 125, INK)
    LINE([(98, 128), (126, 121)], BRASS, 2)                    # pencil
    P(125, 121, (190, 64, 56))

    # --------------------------------------------------------------- lamp
    ELL(134, 126, 158, 133, BRASS_D)
    ELL(136, 125, 156, 131, BRASS)
    LINE([(145, 127), (142, 106), (138, 92), (124, 80)], BRASS, 2)
    P(138, 92, BRASS_D)
    POLY([(104, 74), (126, 70), (132, 84), (100, 90)], (40, 70, 130))
    POLY([(104, 74), (126, 70), (127, 73), (106, 77)], (110, 150, 215))
    bulb = (210, 204, 186) if DAY else (255, 232, 168) if lamp == 1 else (222, 150, 78)
    ELL(108, 88, 124, 94, bulb, not DAY)

    # ------------------------------------------------------------ monitor
    R(172, 40, 268, 101, (30, 32, 46))
    R(172, 40, 268, 42, (52, 56, 80))
    R(177, 45, 263, 96, (10, 24, 28), True)
    R(177, 45, 195, 96, (14, 34, 38), True)                    # file tree
    mr = random.Random(3)
    for i in range(6):
        R(180, 49 + i * 5, 180 + mr.randint(6, 12), 50 + i * 5, MINT_M if i % 3 else MINT, True)
    for i in range(9):
        indent = (0, 4, 4, 8, 8, 4, 4, 0, 0)[i]
        x = 199 + indent
        for _ in range(mr.randint(2, 4)):
            w = mr.randint(4, 14)
            R(x, 49 + i * 5, min(x + w, 258), 50 + i * 5, mr.choice((MINT, AMBER, (140, 150, 180), MINT_M)), True)
            x += w + 3
            if x > 250:
                break
    R(220, 49 + 9 * 5, 223, 51 + 9 * 5, MINT, True)             # cursor
    R(177, 90, 263, 96, (24, 84, 74), True)                     # status bar
    P(220, 98, MINT, True)
    R(216, 101, 224, 108, (30, 32, 46))
    R(202, 107, 238, 111, (30, 32, 46))

    # keyboard
    POLY([(188, 119), (254, 119), (262, 129), (180, 129)], (40, 42, 58))
    for ky in range(0, 3):
        for kx in range(0, 16):
            R(190 + kx * 4 + ky, 121 + ky * 3, 192 + kx * 4 + ky, 122 + ky * 3, (84, 90, 124))

    # ---------------------------------------------------- tea set (about)
    ELL(272, 122, 322, 131, BRASS)
    ELL(274, 123, 320, 129, BRASS_D)
    # glass
    R(280, 112, 288, 124, (190, 220, 214))
    R(281, 115, 287, 124, (176, 100, 40))
    R(280, 112, 288, 113, (230, 244, 240))
    for lx, ly in ((279, 104), (282, 102), (285, 105), (281, 108), (286, 109), (283, 106)):
        R(lx, ly, lx + 3, ly + 3, MINT_M)
        P(lx + 1, ly + 1, MINT)
    # teapot
    ELL(292, 108, 314, 125, BRASS)
    POLY([(298, 100), (306, 100), (309, 110), (295, 110)], BRASS)
    ELL(298, 95, 307, 102, BRASS_D)
    R(302, 92, 304, 96, BRASS)
    POLY([(311, 114), (318, 100), (320, 101), (313, 119)], BRASS)
    LINE([(292, 106), (288, 108), (288, 117), (293, 120)], BRASS_D, 2)
    R(294, 112, 296, 121, (240, 208, 120))
    R(296, 116, 312, 117, BRASS_D)

    # --------------------------------------------------------------- clock
    ELL(326, 103, 334, 109, BRASS)
    ELL(340, 103, 348, 109, BRASS)
    R(322, 107, 352, 127, (96, 40, 56))
    R(322, 107, 352, 109, (150, 70, 80))
    R(325, 111, 349, 123, (8, 28, 22), True)
    R(324, 127, 328, 130, (40, 22, 30))
    R(346, 127, 350, 130, (40, 22, 30))

    # -------------------------------------------------------- record player
    POLY([(368, 109), (448, 109), (454, 128), (362, 128)], WOOD_D)
    R(362, 128, 454, 135, WOOD_DD)
    R(362, 128, 454, 129, (150, 100, 62))
    ELL(369, 110, 429, 127, (150, 150, 172))
    ELL(371, 111, 427, 126, (14, 14, 22))
    for k in range(4):
        ELL(375 + k * 3, 113 + k, 423 - k * 3, 124 - k, (14, 14, 22))
        da.ellipse([375 + k * 3, 113 + k, 422 - k * 3, 123 - k], outline=(42, 42, 60))
    ELL(391, 115, 407, 123, (190, 64, 56))
    P(399, 119, (232, 218, 182))
    ELL(437, 111, 445, 118, BRASS)
    LINE([(441, 113), (415, 120)], (210, 214, 230), 2)
    R(410, 118, 416, 123, (210, 214, 230))
    for kx in (370, 376):
        ELL(kx, 129, kx + 4, 133, BRASS)
    R(440, 129, 448, 131, (232, 218, 182))

    # =================================================================== light
    if DAY:
        # Daylight: a bright warm ambient, sun through the window falling on the desk, the
        # monitor's glow barely showing. The lamp and the fairy lights are off.
        AMB = (0.92, 0.88, 0.84)
        SRC = [  # (x, y, radius, intensity, rgb, up-weight)
            (110, 100, 190, 0.55, (1.0, 0.92, 0.72), 0.6),
            (220, 72, 70, 0.25, (0.30, 0.95, 0.72), 1.0),
        ]
    else:
        AMB = (0.32, 0.31, 0.48)
        SRC = [  # (x, y, radius, intensity, rgb, up-weight)
            (116, 94, 105, 1.55 * lamp, (1.00, 0.74, 0.40), 0.5),
            (418, 94, 85, 0.75, (1.0, 0.72, 0.38), 0.6),
            (220, 72, 130, 1.0, (0.30, 0.95, 0.72), 1.0),
            (104, 52, 72, 0.40, (0.45, 0.55, 1.00), 1.0),
        ] + [(bx, by, 16, 0.42, (1.0, 0.8, 0.45), 1.0) for bx, by in BULBS]


    def light(x, y):
        r, g, b = AMB
        for sx, sy, rad, inten, col, upw in SRC:
            dx, dy = x - sx, y - sy
            d = math.hypot(dx, dy * 1.15)
            if d >= rad:
                continue
            f = (1 - d / rad) ** 1.7 * inten * (upw if dy < 0 else 1.0)
            r += f * col[0]
            g += f * col[1]
            b += f * col[2]
        return r, g, b


    PAL = [
        (8, 9, 18), (13, 15, 30), (20, 23, 46), (30, 34, 68), (44, 50, 92), (66, 74, 128), (100, 112, 170),
        (52, 34, 56), (86, 50, 60), (128, 72, 64), (176, 104, 70), (222, 150, 78), (250, 196, 104), (255, 232, 168),
        (36, 22, 20), (62, 38, 28), (96, 60, 38), (140, 92, 54), (186, 130, 82),
        (14, 46, 44), (24, 84, 74), (46, 140, 110), (110, 214, 170), (190, 246, 220),
        (150, 138, 112), (216, 200, 160), (240, 230, 200),
        (140, 150, 180), (210, 214, 230),
        (120, 38, 40), (190, 64, 56), (40, 70, 130), (80, 120, 190),
        (150, 110, 40), (214, 170, 70), (122, 82, 140), (60, 40, 80),
        (232, 232, 250), (26, 28, 72), (104, 62, 98), (168, 92, 90),
    ]
    if DAY or sky == "day":
        PAL += [
            (110, 168, 222), (150, 196, 234), (196, 222, 238), (240, 226, 200),
            (250, 248, 240), (232, 222, 204), (196, 176, 150), (170, 146, 160), (204, 184, 196),
            (226, 206, 214), (52, 96, 62), (236, 196, 140), (250, 222, 170), (176, 160, 176),
            (206, 176, 146), (186, 154, 124), (226, 198, 166), (166, 134, 108), (244, 220, 186),
        ]

    BAYER = [[0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
             [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
             [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
             [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]]
    SPREAD = 20


    def nearest(r, g, b):
        best, bd = PAL[0], 1e18
        for p in PAL:
            d = 2 * (p[0] - r) ** 2 + 4 * (p[1] - g) ** 2 + 3 * (p[2] - b) ** 2
            if d < bd:
                best, bd = p, d
        return best


    OUT = Image.new("RGB", (W, H))
    for y in range(H):
        for x in range(W):
            ar, ag, ab = A.getpixel((x, y))
            if E.getpixel((x, y)):
                r, g, b = ar, ag, ab
            else:
                lr, lg, lb = light(x, y)
                r, g, b = ar * lr, ag * lg, ab * lb
            off = (BAYER[y % 8][x % 8] / 64 - 0.5) * SPREAD
            OUT.putpixel((x, y), nearest(max(0, min(255, r + off)), max(0, min(255, g + off)), max(0, min(255, b + off))))

    room = OUT.quantize(colors=len(PAL) + 4, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    return room, V


def window_only(room: Image.Image, view: Image.Image) -> Image.Image:
    """`room` with everything but the uncovered view through the window made transparent. The
    frame, the mullions and the lamp stay in the room underneath, so they keep its light."""
    # Stay a palette image: one spare palette entry becomes the transparent one.
    clear = len(room.getpalette()) // 3
    out = room.copy()
    out.putpalette(room.getpalette() + [0, 0, 0])
    out.paste(clear, mask=Image.eval(view, lambda v: 255 - v))
    out.info["transparency"] = clear
    return out


outputs = {
    "room-night.png": draw(False)[0],
    "room-day.png": draw(True)[0],
    "room-night-dim.png": draw(False, lamp=0.35)[0],
    **{f"window-{sky}.png": window_only(*draw(False, sky)) for sky in ("day", "dusk", "night")},
}
for name, image in outputs.items():
    target = OUT_DIR / name
    image.save(target, optimize=True)
    print(f"{target.name}: {target.stat().st_size / 1024:.1f} KiB")

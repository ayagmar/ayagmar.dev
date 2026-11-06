#!/usr/bin/env python3
"""Turns an image into a text map for a post's art (ADR 0027). The image is not shipped.

    just art-map IMAGE my-post --dark .6

--dark N  the subject is dark on a pale studio sweep: keep what is darker than N of the sweep.
          Leave it out when the subject already sits on black.
--at F    where the figure's centre sits across the picture, 0 to 1.
--echo F  a second copy in dim dots only, centred at F; repeat for more.
--top N   the share of the subject's cells that become bright. A percentile of the subject's own
          tones, so the exposure of the image does not matter.

The steps follow the method of github.com/0xSero/ascii-art (MIT): sample a region per cell, local
contrast so that shading inside the subject survives, thresholds from the subject's own tones. A
relief raised from the silhouette gives every subject the same light from the lamp's side.
"""
import argparse

import numpy as np
from PIL import Image
from scipy import ndimage as ni

COLS, ROWS = 144, 30   # the lattice of apps/site/src/lib/art.ts
ASPECT = 1.6           # a cell is 10 x 16
FIGURE_ROWS = 28
Q = 12                 # samples per cell, each way


def fit(a, size, mode=Image.LANCZOS):
    grey = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    return np.asarray(grey.resize(size, mode)).astype(float) / 255


def to_map(gray, mask, rows=FIGURE_ROWS, top=45, blur=1.0, mix=0.8, relief=0.55, accent=None):
    """A grey image and a subject mask of one size, as map rows of `#`, `.`, `+` and spaces."""
    ys, xs = np.where(mask)
    box = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
    gray, mask = gray[box], mask[box].astype(float)
    height, width = gray.shape
    cols = max(1, round(width / height * rows * ASPECT))
    size = (cols * Q, rows * Q)
    g, m = fit(gray, size), fit(mask, size, Image.BILINEAR)

    def inner(v, s):
        # Inside the subject only, so a bright studio ground never leaks in as a rim of light.
        return ni.gaussian_filter(v * m, s) / np.maximum(ni.gaussian_filter(m, s), 1e-3)

    def z(v):
        return (v - v[m > .5].mean()) / (v[m > .5].std() + 1e-6)

    tone = z(inner(g, blur * Q / 4) - mix * inner(g, Q * 6))
    if relief:
        gy, gx = np.gradient(ni.gaussian_filter(np.sqrt(ni.distance_transform_edt(m > .5)), Q * .8))
        tone = (1 - relief) * tone + relief * z((gx + gy) * .7)

    def cell(v):
        return v.reshape(rows, Q, cols, Q).mean((1, 3))

    t, inside = cell(tone), cell(m) > .45
    bright = np.percentile(t[inside], 100 - top)
    amber = cell(fit(accent[box], size)) > .4 if accent is not None else np.zeros_like(inside)
    return [''.join('+' if inside[j, i] and amber[j, i] else
                    '#' if inside[j, i] and t[j, i] > bright else
                    '.' if inside[j, i] else ' ' for i in range(cols)) for j in range(rows)]


def canvas():
    return [[' '] * COLS for _ in range(ROWS)]


def stamp(grid, figure, at, dim=False):
    """Lays a figure on the canvas, centred in height, its centre `at` across."""
    c0 = round(COLS * at - max(map(len, figure)) / 2)
    r0 = (ROWS - len(figure)) // 2
    for j, line in enumerate(figure):
        for i, ch in enumerate(line):
            if ch != ' ' and 0 <= r0 + j < ROWS and 0 <= c0 + i < COLS:
                grid[r0 + j][c0 + i] = '.' if dim else ch
    return grid


def write(path, grid):
    with open(path, 'w') as out:
        out.write(''.join(''.join(row) + '\n' for row in grid))


def subject(path, dark):
    """The image in grey, and the mask of its subject."""
    lum = np.asarray(Image.open(path).convert('L')).astype(float) / 255
    if dark is None:
        return lum, lum > .05
    h, w = lum.shape

    def basis(y, x):
        return np.stack([np.ones_like(x, float), x / w, y / h, (x / w) ** 2, (y / h) ** 2, x * y / w / h], -1)

    # The sweep as a smooth surface, refitted without whatever sits well under it. A soft cast
    # shadow stays above the --dark line, which a cut on colour could not tell from the subject.
    ys, xs = np.mgrid[0:h:4, 0:w:4]
    keep = np.ones(ys.shape, bool)
    for _ in range(6):
        coef = np.linalg.lstsq(basis(ys[keep], xs[keep]), lum[ys[keep], xs[keep]], rcond=None)[0]
        keep = lum[ys, xs] > (basis(ys, xs) @ coef) * .93
    yy, xx = np.mgrid[0:h, 0:w]
    mask = ni.gaussian_filter(lum, 1) < (basis(yy, xx) @ coef) * dark
    mask = ni.binary_opening(ni.binary_fill_holes(ni.binary_closing(mask, iterations=2)), iterations=1)
    labels, count = ni.label(mask)
    return lum, labels == 1 + np.argmax(ni.sum(mask, labels, range(1, count + 1)))


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('image')
    a.add_argument('out')
    a.add_argument('--dark', type=float)
    a.add_argument('--at', type=float, default=.62)
    a.add_argument('--echo', type=float, action='append', default=[])
    a.add_argument('--top', type=float, default=45)
    o = a.parse_args()
    figure = to_map(*subject(o.image, o.dark), top=o.top)
    grid = canvas()
    for at in o.echo:
        stamp(grid, figure, at, dim=True)
    write(o.out, stamp(grid, figure, o.at))


if __name__ == '__main__':
    main()

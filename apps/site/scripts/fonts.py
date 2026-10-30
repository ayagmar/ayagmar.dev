"""Builds the site's self-hosted fonts (ADR 0026) from the upstream releases.

Downloads each release once into ~/.cache/min7-fonts, checks its sha256, subsets it to the
characters the site uses and writes WOFF2 files into src/fonts/. The outputs are committed;
run this again only to change the character set or a font version: `just fonts`.
"""

import hashlib
import io
import sys
import urllib.request
import zipfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

OUT = Path(__file__).resolve().parent.parent / "src" / "fonts"
CACHE = Path.home() / ".cache" / "min7-fonts"

RELEASES = {
    "serif": (
        "https://github.com/adobe-fonts/source-serif/releases/download/4.005R/source-serif-4.005_Desktop.zip",
        "549fdb8f9a682bd06944298621404969f6de77c2e422ff3b8244a1dcd6a0c425",
    ),
    "mono": (
        "https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip",
        "6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf",
    ),
    # Fraunces: the latest tagged release (1.000, 2020) predates the variable font the site uses,
    # so this is upstream's latest commit (2025-10-21, font version 1.003). A bare TTF, not a zip.
    "display": (
        "https://raw.githubusercontent.com/undercasetype/Fraunces/7ccdec31c6028118dce3e47fe864e3744460371d/fonts/variable/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf",
        "0776a870a0856b296e11639505ac0cf9be5e7800bb1849dfa21a1bd182455fc0",
    ),
}

# Basic Latin, Latin-1 (accented names, no-break space, middle dot, guillemets), and the
# typographic punctuation and arrows the pages and posts use.
UNICODES = [
    *range(0x20, 0x7F),
    *range(0xA0, 0x100),
    0x2009, 0x2010, 0x2011, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D,
    0x2022, 0x2026, 0x2032, 0x2033, 0x2039, 0x203A, 0x2190, 0x2191, 0x2192, 0x2193, 0x2197,
    0x2212, 0x00D7,
]

# (output name, release, file in the zip, axis limits). Weights are cut to the 400 to 700 the
# CSS uses. Both are pinned to the text optical size (opsz 16): the optical size axis more than
# doubles the roman, the preloaded face, which pushed mobile LCP past 2 s. Headings use the
# text cut too.
# The fourth field renames the family inside the file: "Source" is a Reserved Font Name under
# the OFL, and a subset is a modified version, so the subset may not carry it.
FONTS = [
    ("serif-roman.woff2", "serif", "source-serif-4.005_Desktop/VAR/SourceSerif4Variable-Roman.ttf", {"wght": (400, 700), "opsz": 16}, "min7 Serif"),
    ("serif-italic.woff2", "serif", "source-serif-4.005_Desktop/VAR/SourceSerif4Variable-Italic.ttf", {"wght": (400, 700), "opsz": 16}, "min7 Serif"),
    ("mono.woff2", "mono", "fonts/variable/JetBrainsMono[wght].ttf", {"wght": (400, 700)}, None),
    # The name, headings and big numbers; never running text. Pinned to the soft, wonky cut at one
    # optical size, so no axis stays: one weight, 750.
    ("display.woff2", "display", None, {"wght": 750, "opsz": 48, "SOFT": 100, "WONK": 1}, None),
]
# Headings are letters, digits and punctuation: no symbols, arrows or Latin-1 signs, which cost 4 KB.
DISPLAY_UNICODES = [
    *range(0x20, 0x7F), 0xA0, 0xA9, 0xB7, 0xD7, *range(0xC0, 0x100),
    0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026, 0x2192, 0x2212,
]
DISPLAY_FEATURES = ["kern", "liga", "ccmp", "locl", "mark", "mkmk"]
FEATURES = ["kern", "liga", "calt", "onum", "lnum", "tnum", "pnum", "frac", "sups", "subs", "ccmp", "locl", "mark", "mkmk", "case"]


def release(name: str) -> bytes:
    url, sha256 = RELEASES[name]
    path = CACHE / url.rsplit("/", 1)[1]
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url) as response:
            path.write_bytes(response.read())
    data = path.read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if actual != sha256:
        sys.exit(f"{path}: sha256 {actual}, expected {sha256}")
    return data


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for out, name, member, limits, family in FONTS:
        data = release(name)
        if member is not None:
            data = zipfile.ZipFile(io.BytesIO(data)).read(member)
        font = TTFont(io.BytesIO(data), lazy=False)
        options = subset.Options()
        # Headings and numerals need kerning and ligatures, not the text face's small caps, fractions
        # or figure styles.
        options.layout_features = DISPLAY_FEATURES if out == "display.woff2" else FEATURES
        options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
        options.notdef_outline = True
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=DISPLAY_UNICODES if out == "display.woff2" else UNICODES)
        subsetter.subset(font)
        font = instancer.instantiateVariableFont(font, limits)
        if family is not None:
            names = font["name"]
            style = names.getDebugName(2) or "Regular"
            for record in list(names.names):
                if record.nameID in (1, 3, 4, 6, 16, 17, 21, 22, 25):
                    names.removeNames(nameID=record.nameID)
            names.setName(family, 1, 3, 1, 0x409)
            names.setName(style, 2, 3, 1, 0x409)
            names.setName(f"{family} {style}", 4, 3, 1, 0x409)
            names.setName(f"{family.replace(' ', '')}-{style.replace(' ', '')}", 6, 3, 1, 0x409)
            names.setName(f"{family}; {style}; subset", 3, 3, 1, 0x409)
        target = OUT / out
        font.flavor = "woff2"
        font.save(target)
        size = target.stat().st_size
        total += size
        print(f"{target.name}: {size / 1024:.1f} KiB")
    print(f"fonts: {total / 1024:.1f} KiB")


main()

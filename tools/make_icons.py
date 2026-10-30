"""Generate app icons (home screen / install): a citation slip.

Usage: python3 tools/make_icons.py
Writes assets/icons/: icon-192.png, icon-512.png, icon-maskable-512.png,
apple-touch-icon.png (180px).

The slip is drawn with shapes (no fonts) at 4x and scaled down, so the
icons look the same on any machine.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/icons"
SS = 4  # supersampling

BG = "#1d5fa8"      # app accent blue
PAPER = "#ffffff"
SHADOW = "#164a83"
HEADER = "#d8262e"  # the map's "picked" red
LINE = "#c3cad3"
INK = "#1f2a36"


def slip(size):
    """The citation slip on a transparent square, sized to fill `size`."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = s / 100  # draw in a 100-unit box

    def box(x0, y0, x1, y1):
        return [x0 * u, y0 * u, x1 * u, y1 * u]

    # paper with a drop shadow
    d.rounded_rectangle(box(19, 9, 85, 95), radius=6 * u, fill=SHADOW)
    d.rounded_rectangle(box(15, 5, 81, 91), radius=6 * u, fill=PAPER)
    # red header band
    d.rounded_rectangle(box(15, 5, 81, 25), radius=6 * u, fill=HEADER)
    d.rectangle(box(15, 18, 81, 25), fill=HEADER)
    d.rounded_rectangle(box(23, 12.5, 61, 17.5), radius=2.5 * u, fill=PAPER)  # title bar
    # filled-in lines
    for y, x1 in ((33, 73), (42, 66), (51, 70)):
        d.rounded_rectangle(box(23, y, x1, y + 4), radius=2 * u, fill=LINE)
    # checkbox rows, first one ticked
    for y, ticked in ((61, True), (70, False)):
        d.rounded_rectangle(box(23, y, 30, y + 7), radius=1.5 * u, outline=INK, width=round(1.4 * u))
        d.rounded_rectangle(box(34, y + 1.5, 58, y + 5.5), radius=2 * u, fill=LINE)
        if ticked:
            d.line([(24.5 * u, (y + 3.5) * u), (26.5 * u, (y + 5.5) * u), (32 * u, (y - 1.5) * u)],
                   fill=HEADER, width=round(2.2 * u), joint="curve")
    # signature line with a squiggle
    d.line([(23 * u, 85 * u), (73 * u, 85 * u)], fill=LINE, width=round(1.2 * u))
    d.line([(25 * u, 83 * u), (29 * u, 78 * u), (32 * u, 83 * u), (36 * u, 78.5 * u),
            (39 * u, 82.5 * u), (44 * u, 80 * u)], fill=INK, width=round(1.6 * u), joint="curve")
    return img.resize((size, size), Image.LANCZOS)


def icon(size, content_ratio):
    """Blue square with the slip centred, scaled to content_ratio of the side."""
    canvas = Image.new("RGBA", (size, size), BG)
    inner = slip(round(size * content_ratio))
    off = (size - inner.width) // 2
    canvas.alpha_composite(inner, (off, off))
    return canvas.convert("RGB")


OUT.mkdir(parents=True, exist_ok=True)
icon(192, 0.80).save(OUT / "icon-192.png")
icon(512, 0.80).save(OUT / "icon-512.png")
icon(512, 0.62).save(OUT / "icon-maskable-512.png")  # Android masks to ~80% circle
icon(180, 0.80).save(OUT / "apple-touch-icon.png")
print("wrote", sorted(p.name for p in OUT.iterdir()))

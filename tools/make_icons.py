"""Generate app icons (home screen / install) from the logo.

Usage: python3 tools/make_icons.py
Writes assets/icons/: icon-192.png, icon-512.png, icon-maskable-512.png,
apple-touch-icon.png (180px).
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LOGO = Image.open(ROOT / "assets/images/logo-circle.png").convert("RGB")
OUT = ROOT / "assets/icons"


def icon(size, content_ratio):
    """White square with the logo centred, scaled to content_ratio of the side."""
    canvas = Image.new("RGB", (size, size), "white")
    box = int(size * content_ratio)
    scale = box / max(LOGO.size)
    logo = LOGO.resize((round(LOGO.width * scale), round(LOGO.height * scale)), Image.LANCZOS)
    canvas.paste(logo, ((size - logo.width) // 2, (size - logo.height) // 2))
    return canvas


OUT.mkdir(parents=True, exist_ok=True)
icon(192, 0.88).save(OUT / "icon-192.png")
icon(512, 0.88).save(OUT / "icon-512.png")
icon(512, 0.68).save(OUT / "icon-maskable-512.png")  # Android masks to ~80% circle
icon(180, 0.84).save(OUT / "apple-touch-icon.png")
print("wrote", sorted(p.name for p in OUT.iterdir()))

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "icons"


def make_icon(size: int, maskable: bool) -> Image.Image:
    image = Image.new("RGBA", (size, size), "#07111f")
    draw = ImageDraw.Draw(image)
    scale = size / 512
    radius = int((96 if maskable else 112) * scale)
    draw.rounded_rectangle((0, 0, size, size), radius=radius, fill="#07111f")
    panel = tuple(int(v * scale) for v in (128, 104, 384, 408))
    draw.rounded_rectangle(panel, radius=int(48 * scale), fill="#0f1e33")
    line_width = max(8, int(28 * scale))
    for coords in [(168, 168, 344, 168), (168, 224, 272, 224), (168, 280, 344, 280), (168, 336, 304, 336)]:
        draw.line(tuple(int(v * scale) for v in coords), fill="#d8fff8", width=line_width)
    check = [(320, 216), (362, 258), (436, 172)]
    draw.line([(int(x * scale), int(y * scale)) for x, y in check], fill="#2dd4bf", width=max(10, int(34 * scale)), joint="curve")
    cx, cy, r = int(128 * scale), int(384 * scale), int(58 * scale)
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill="#f59e0b")
    plus_width = max(8, int(22 * scale))
    draw.line((int(103 * scale), cy, int(153 * scale), cy), fill="#07111f", width=plus_width)
    draw.line((cx, int(359 * scale), cx, int(409 * scale)), fill="#07111f", width=plus_width)
    try:
        font = ImageFont.truetype("arialbd.ttf", int(74 * scale))
    except OSError:
        font = ImageFont.load_default()
    draw.text((int(230 * scale), int(354 * scale)), "Z", fill="#2dd4bf", font=font, anchor="mm")
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, maskable in [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-192.png", 192, True),
        ("icon-maskable-512.png", 512, True),
    ]:
        make_icon(size, maskable).save(OUT / name)


if __name__ == "__main__":
    main()

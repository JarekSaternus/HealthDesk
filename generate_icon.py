"""Generate a simple app icon programmatically."""
from PIL import Image, ImageDraw, ImageFont
import os
import sys

def generate_icon():
    if getattr(sys, 'frozen', False):
        # Running as PyInstaller bundle - assets bundled in _MEIPASS
        base = sys._MEIPASS
    else:
        base = os.path.dirname(__file__)
    icon_path = os.path.join(base, "assets", "icon.ico")
    if os.path.exists(icon_path):
        return icon_path

    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Green circle background
    draw.ellipse([2, 2, size - 2, size - 2], fill=(46, 204, 113), outline=(39, 174, 96), width=2)

    # Clock hands (white)
    cx, cy = size // 2, size // 2
    # Hour hand
    draw.line([(cx, cy), (cx, cy - 16)], fill="white", width=3)
    # Minute hand
    draw.line([(cx, cy), (cx + 12, cy - 8)], fill="white", width=2)
    # Center dot
    draw.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill="white")

    # Heart (health symbol) in bottom right
    draw.text((size - 20, size - 22), "+", fill="white")

    os.makedirs(os.path.dirname(icon_path), exist_ok=True)
    img.save(icon_path, format="ICO", sizes=[(64, 64)])
    return icon_path


if __name__ == "__main__":
    path = generate_icon()
    print(f"Icon saved to {path}")

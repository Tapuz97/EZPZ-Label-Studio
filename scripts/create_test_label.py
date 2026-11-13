"""Create a new diagnostic label and matching app PrintJob; never contacts hardware."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
width_mm, height_mm, dpi = 60, 90, 203
width, height = round(width_mm * dpi / 25.4), round(height_mm * dpi / 25.4)
image = Image.new("RGBA", (width, height), "white")
draw = ImageDraw.Draw(image)
regular = "C:/Windows/Fonts/arial.ttf"
bold = "C:/Windows/Fonts/arialbd.ttf"

def centered(text, y, size, heavy=False):
    font = ImageFont.truetype(bold if heavy else regular, size)
    box = draw.textbbox((0, 0), text, font=font)
    draw.text(((width - (box[2] - box[0])) / 2, y), text, font=font, fill="black")

draw.rectangle((24, 24, width - 25, height - 25), outline="black", width=3)
centered("EZPZ LABEL STUDIO", 78, 32, True)
centered("DB403", 165, 46, True)
centered("Windows Bluetooth test", 248, 27)
draw.line((60, 309, width - 60, 309), fill="black", width=2)
centered("60 x 90 mm", 340, 25)
centered("203 DPI / 1 copy", 379, 23)
cell, count = 10, 6
left, top = (width - cell * count) // 2, 460
for row in range(count):
    for col in range(count):
        if (row + col) % 2 == 0:
            draw.rectangle((left + col * cell, top + row * cell,
                            left + (col + 1) * cell - 1, top + (row + 1) * cell - 1), fill="black")
centered("Native Windows BLE", 565, 24)
OUTPUT = ROOT / "output/diagnostics"
OUTPUT.mkdir(parents=True, exist_ok=True)
image.save(OUTPUT / "test-label.png")
job = dict(widthMm=width_mm, heightMm=height_mm, gapMm=2, dpi=dpi, copies=1,
           density=8, rgba=list(image.tobytes()), widthPx=width, heightPx=height,
           threshold=128, protocol="zpl")
(OUTPUT / "test-label.json").write_text(json.dumps(job, separators=(",", ":")), encoding="utf-8")
print(f"Created {width} x {height} RGBA pixels. No printer contacted.")

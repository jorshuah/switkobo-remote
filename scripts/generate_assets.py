"""Generate the app's original geometric icon; no third-party artwork."""
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".tools"))
from PIL import Image, ImageDraw

image = Image.new("RGB", (1024, 1024), "#111715")
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((282, 130, 742, 894), radius=105, fill="#222d27")
draw.rounded_rectangle((348, 208, 676, 272), radius=24, fill="#64796c")
draw.rounded_rectangle((458, 336, 566, 652), radius=38, fill="#f2f4ee")
draw.rounded_rectangle((354, 440, 670, 548), radius=38, fill="#f2f4ee")
draw.ellipse((447, 429, 577, 559), fill="#111715")
draw.ellipse((465, 447, 559, 541), fill="#bce8cb")
draw.rounded_rectangle((354, 734, 482, 802), radius=30, fill="#64796c")
draw.rounded_rectangle((542, 734, 670, 802), radius=30, fill="#bce8cb")
target = ROOT / "App/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
image.save(target, optimize=True)
print(f"Generated original 1024px RGB app icon: {target.relative_to(ROOT)}")

# Creating a 3x3 Image Collage

## Prerequisites

- **ImageMagick** must be installed (`magick` command available)
- **Python 3** with **Pillow** must be installed (`python3 -c "from PIL import Image"`)
- All source images must be in the `uploads/` directory

## Image Layout

The 3x3 grid follows this layout:

```
[Row 1, Col 1]  [Row 1, Col 2]  [Row 1, Col 3]
[Row 2, Col 1]  [Row 2, Col 2]  [Row 2, Col 3]
[Row 3, Col 1]  [Row 3, Col 2]  [Row 3, Col 3]
```

## Steps

### 1. Prepare source images

Ensure all 9 images exist in `uploads/`. Download any missing images from their source URLs before proceeding.

### 2. Resize and fill each cell to 400x400px

Each image must be **zoomed and center-cropped** to fill a uniform 400x400px cell. Use `resize` with the `^` flag (force dimensions) followed by `-extent` to crop to center:

```bash
magick input.jpg -resize 400x400^ -gravity center -extent 400x400 output.png
```

- `-resize 400x400^` — scales the image so that **both** dimensions are at least 400px (the smaller dimension fills 400px, the larger one exceeds it)
- `-gravity center -extent 400x400` — crops the center 400x400px region

**Do NOT use** `-resize 400x400` alone — this fits the image within 400x400 while preserving aspect ratio, resulting in different-sized cells with letterboxing.

### 3. Add game title lower-third labels

Each cell must have a semi-transparent black bar at the bottom with the game title in white text. Use Python/Pillow (ImageMagick `-annotate` requires Ghostscript which is not installed):

```python
from PIL import Image, ImageDraw, ImageFont
import os

font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 30)

for title, fname in projects:
    img = Image.open(fname).convert("RGBA")
    draw = ImageDraw.Draw(img)
    # Semi-transparent black bar at bottom (80px tall)
    draw.rectangle([(0, 320), (400, 400)], fill=(0, 0, 0, 184))
    # Center text in the bar
    bbox = draw.textbbox((0, 0), title, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (400 - tw) // 2
    y = 320 + (80 - th) // 2
    draw.text((x, y), title, fill=(255, 255, 255, 255), font=font)
    img.convert("RGB").save(out, "PNG")
```

**Title shortening rules:**
- Strip taglines, subtitles, and secondary descriptors in brackets/colons (e.g., `[A Solo 4x Card Game]`, `: The Card Game`, `: Uncover the truth`)
- Keep the core game name only (e.g., "Overclock", "Cloaked Cryptids", "Six Eyes")
- If a title is still too long, abbreviate further
- The text must fit within the 400px cell width without truncation

### 4. Assemble 3 horizontal rows

```bash
magick cell1.png cell2.png cell3.png +append row1.png
```

### 5. Stack rows vertically into the final grid

```bash
magick row1.png row2.png row3.png -append \
  uploads/pnp-collage-3x3-live-sep-2.png
```

### 6. Verify

```bash
identify uploads/pnp-collage-3x3-live-sep-2.png
# Expected: 1200x1200 (3x400, no borders)
```

## Full Example

```bash
# Step 2: Resize all 9 images to 400x400
for img in uploads/img1.jpg uploads/img2.jpg uploads/img3.jpg \
           uploads/img4.jpg uploads/img5.jpg uploads/img6.jpg \
           uploads/img7.jpg uploads/img8.jpg uploads/img9.jpg; do
   base=$(basename "$img" | sed 's/\.[^.]*$//')
   magick "$img" -resize 400x400^ -gravity center -extent 400x400 "/tmp/collage/${base}.png"
done

# Step 3: Add labels via Python (see label script above)
# Produces labeled_final_*.png files

# Step 4: Build 3 horizontal rows
magick /tmp/collage/labeled_img1.png /tmp/collage/labeled_img2.png /tmp/collage/labeled_img3.png +append /tmp/collage/row1.png
magick /tmp/collage/labeled_img4.png /tmp/collage/labeled_img5.png /tmp/collage/labeled_img6.png +append /tmp/collage/row2.png
magick /tmp/collage/labeled_img7.png /tmp/collage/labeled_img8.png /tmp/collage/labeled_img9.png +append /tmp/collage/row3.png

# Step 5: Assemble grid
magick /tmp/collage/row1.png /tmp/collage/row2.png /tmp/collage/row3.png -append \
  uploads/pnp-collage-3x3-live-sep-2.png
```

## Common Mistakes to Avoid

| Mistake | Result | Fix |
|---------|--------|-----|
| `-resize 400x400` without `^` | Different-sized cells with padding | Use `-resize 400x400^ -gravity center -extent 400x400` |
| `+append` for all 9 images at once | Single horizontal row of 9 | Group into 3 rows of 3, then `-append` the rows |
| `-annotate` for text labels | Ghostscript errors, broken output | Use Python/Pillow instead (see Step 3) |
| Using `.jpg` intermediate format | Quality loss on each step | Use `.png` for intermediate files |
| Truncated labels | Title cut off at edges | Shorten title by removing taglines/subtitles |
| Using `.miff` intermediates | Not needed with PNG pipeline | Use `.png` throughout |

## Filename Convention

Collage files follow the pattern: `pnp-collage-3x3-live-<month>-<day>.png` (e.g., `pnp-collage-3x3-live-sep-2.png`). Use the current month abbreviation and day number.

# Creating a 3x3 Image Collage

## Prerequisites

- **ImageMagick** must be installed (`magick` command available)
- **No Ghostscript** — do not use `-annotate` for text overlays (it requires Ghostscript which is not installed)
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
magick input.jpg -resize 400x400^ -gravity center -extent 400x400 output.miff
```

- `-resize 400x400^` — scales the image so that **both** dimensions are at least 400px (the smaller dimension fills 400px, the larger one exceeds it)
- `-gravity center -extent 400x400` — crops the center 400x400px region

**Do NOT use** `-resize 400x400` alone — this fits the image within 400x400 while preserving aspect ratio, resulting in different-sized cells with letterboxing.

**Do NOT use** `-annotate` for labels — Ghostscript is not available and will cause errors.

### 3. Assemble 3 horizontal rows

```bash
magick cell1.miff cell2.miff cell3.miff +append row1.miff
```

### 4. Stack rows vertically into the final grid

```bash
magick row1.miff row2.miff row3.miff -append \
  -bordercolor black -border 4 \
  uploads/pnp-collage-3x3.jpg
```

### 5. Verify

```bash
identify uploads/pnp-collage-3x3.jpg
# Expected: 1208x1208 (3x400 + 4px borders on all sides)
```

## Full Example

```bash
# Resize all 9 images
for img in uploads/img1.jpg uploads/img2.jpg uploads/img3.jpg \
           uploads/img4.jpg uploads/img5.jpg uploads/img6.jpg \
           uploads/img7.jpg uploads/img8.jpg uploads/img9.jpg; do
  base=$(basename "$img" | sed 's/\.[^.]*$//')
  magick "$img" -resize 400x400^ -gravity center -extent 400x400 "/tmp/collage/${base}.miff"
done

# Build rows
magick /tmp/collage/img1.miff /tmp/collage/img2.miff /tmp/collage/img3.miff +append /tmp/collage/row1.miff
magick /tmp/collage/img4.miff /tmp/collage/img5.miff /tmp/collage/img6.miff +append /tmp/collage/row2.miff
magick /tmp/collage/img7.miff /tmp/collage/img8.miff /tmp/collage/img9.miff +append /tmp/collage/row3.miff

# Assemble grid
magick /tmp/collage/row1.miff /tmp/collage/row2.miff /tmp/collage/row3.miff -append \
  -bordercolor black -border 4 \
  uploads/pnp-collage-3x3.jpg
```

## Common Mistakes to Avoid

| Mistake | Result | Fix |
|---------|--------|-----|
| `-resize 400x400` without `^` | Different-sized cells with padding | Use `-resize 400x400^ -gravity center -extent 400x400` |
| `+append` for all 9 images at once | Single horizontal row of 9 | Group into 3 rows of 3, then `-append` the rows |
| `-annotate` for text labels | Ghostscript errors, broken output | Skip text labels entirely |
| Using `.jpg` intermediate format | Quality loss on each step | Use `.miff` for intermediate files |

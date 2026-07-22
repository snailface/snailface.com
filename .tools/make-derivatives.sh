#!/bin/bash
# Regenerate map-photos derivatives.
#   <name>-480.jpg   : map.html popup thumbnail (long edge <= 480)
#   <name>-1400.jpg  : post.html article photo (long edge <= 1400, never upscaled)
# Originals are left untouched (they keep EXIF/GPS and are what the lightbox opens).
#
# sips does the resample + Display-P3 -> sRGB conversion into a lossless PNG;
# cjpeg (libjpeg-turbo) does the single lossy encode with optimized Huffman
# tables and progressive scans. cjpeg writes no EXIF/ICC, so the derivatives
# are metadata-free; the pixels are sRGB, which untagged JPEG is read as.
set -euo pipefail

# Resolved relative to this script so it works from any checkout. This lives in
# .tools/ rather than beside the photos because Cloudflare Pages serves the repo
# root verbatim — anything in map-photos/ would be publicly fetchable.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../map-photos" && pwd)"
SRGB="/System/Library/ColorSync/Profiles/sRGB Profile.icc"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cd "$DIR"
for f in *.jpg; do
  case "$f" in *-480.jpg|*-1400.jpg) continue;; esac
  base="${f%.jpg}"
  w=$(sips -g pixelWidth "$f" | awk '/pixelWidth/{print $2}')
  h=$(sips -g pixelHeight "$f" | awk '/pixelHeight/{print $2}')
  long=$(( w > h ? w : h ))

  for target in 480 1400; do
    box=$target
    # never upscale: cap the bounding box at the source's long edge
    if [ "$long" -lt "$box" ]; then box=$long; fi
    sips -Z "$box" --matchTo "$SRGB" -s format png "$f" --out "$TMP/x.png" >/dev/null
    cjpeg -quality 80 -optimize -progressive -outfile "$base-$target.jpg" "$TMP/x.png"
  done
done

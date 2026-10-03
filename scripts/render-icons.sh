#!/usr/bin/env sh
# Renders public/icons/icon.svg into the PNG sizes public/app.webmanifest declares, and into
# public/favicon.ico. Needs rsvg-convert and ImageMagick 7, on NixOS:
#   nix shell nixpkgs#librsvg nixpkgs#imagemagick -c npm run icons:render
set -eu
cd "$(dirname "$0")/.."

for size in 192 512; do
  rsvg-convert -w "$size" -h "$size" public/icons/icon.svg -o "public/icons/icon-$size.png"
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for size in 16 32 48; do
  rsvg-convert -w "$size" -h "$size" public/icons/icon.svg -o "$tmp/$size.png"
done
magick "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" public/favicon.ico

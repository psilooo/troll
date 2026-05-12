#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p encoded

# Loop: 4K60 master → 1080p60 H.264 CRF 22, no audio, faststart, explicit BT.709
# tagging so browsers don't drift between BT.601/BT.709 defaults.
ffmpeg -y -i videos/looper.mov \
  -vf "scale=1920:1080:flags=lanczos" \
  -r 60 \
  -c:v libx264 -preset slow -crf 22 -profile:v high -level 4.2 -pix_fmt yuv420p \
  -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -map 0:v:0 -an -movflags +faststart \
  encoded/looper.mp4

# Reveal: 1080p24 master, already small — just remux to add faststart.
# -map 0:v:0 -an is defensive: if a future master gains an audio track, drop it.
ffmpeg -y -i videos/on_click.mp4 \
  -map 0:v:0 -an \
  -c copy -movflags +faststart \
  encoded/on_click.mp4

du -h encoded/*

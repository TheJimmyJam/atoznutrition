#!/bin/sh
# Stand-in lesson clips for /glp1 until Anne records hers: a plain navy title card, 10 s, a silent audio track,
# H.264 + faststart, plus a poster jpg. Captions (.vtt) are hand-written beside them. Plays no sound.
# Run: sh tools/make-standins.sh   (needs ~/Desktop/Projects/.tools/bin/ffmpeg)
set -eu
FF="${FFMPEG:-$HOME/Desktop/Projects/.tools/bin/ffmpeg}"
FONT="${FONT:-/System/Library/Fonts/Avenir Next.ttc}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/glp1/media"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

clip() { # id, title
  printf '%s' "$2" > "$TMP/title.txt"
  printf '%s' "Sample, Anne's lesson coming soon" > "$TMP/label.txt"
  printf '%s' "A to Z Nutrition" > "$TMP/brand.txt"
  VF="drawtext=fontfile='$FONT':textfile='$TMP/brand.txt':fontcolor=0xe5c388:fontsize=26:x=(w-text_w)/2:y=h*0.26,\
drawtext=fontfile='$FONT':textfile='$TMP/title.txt':fontcolor=white:fontsize=56:x=(w-text_w)/2:y=(h-text_h)/2,\
drawtext=fontfile='$FONT':textfile='$TMP/label.txt':fontcolor=0xe1eaf1:fontsize=26:x=(w-text_w)/2:y=h*0.68"
  "$FF" -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=0x142e50:s=854x480:r=24:d=10" \
    -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" \
    -vf "$VF" -t 10 -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 30 -tune stillimage \
    -c:a aac -b:a 32k -shortest -movflags +faststart "$OUT/$1.mp4"
  "$FF" -hide_banner -loglevel error -y -ss 1 -i "$OUT/$1.mp4" -frames:v 1 -q:v 5 "$OUT/$1.jpg"
}

clip start-here "Start here"
clip protein "Protein across the day"
clip hard-days "Small meals and hard days"
ls -l "$OUT"

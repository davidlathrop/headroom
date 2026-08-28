#!/usr/bin/env bash
# Re-capture the eight screens the demo video is built from, using the demo database — never
# a real one. Run from the repo root with the app built for demo data:
#
#   HEADROOM_DB=./data/demo.sqlite HEADROOM_IMPORT_DIR=./data/demo-imports npx tsx scripts/demo.ts
#   HEADROOM_DB=./data/demo.sqlite HEADROOM_IMPORT_DIR=./data/demo-imports NEXT_DIST_DIR=.next-build npx next build
#   HEADROOM_DB=./data/demo.sqlite HEADROOM_IMPORT_DIR=./data/demo-imports NEXT_DIST_DIR=.next-build npx next start -p 3123 &
#   BUDGET=<a budget id> BATCH=<a previewed import id> video/scripts/capture.sh
#
# Screens are 1600×900 at 2× (3200×1800), which the composition scales into its window frame.
set -euo pipefail
BASE="${BASE:-http://localhost:3123}"
OUT="$(dirname "$0")/../public/screens"
CH="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
mkdir -p "$OUT"
shot() {
  "$CH" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size=1600,900 --virtual-time-budget=8000 --screenshot="$OUT/$1.png" "$BASE$2" 2>/dev/null
  echo "$1"
}
shot 01-home "/"
shot 02-import "/import/${BATCH:?set BATCH to a previewed import id}"
shot 03-transactions "/transactions?month=2026-07"
shot 04-months "/months"
shot 05-budget "/budgets/${BUDGET:?set BUDGET to a budget id}?month=2026-07&months=6"
shot 06-forecast "/forecast"
shot 07-trends "/trends?months=6"
shot 08-accounts "/accounts"

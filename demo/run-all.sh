#!/usr/bin/env bash
# Runs the three presentation demos in order. Run from anywhere; it moves to the repository root first.
set -e
cd "$(dirname "$0")/.."
for demo in 01-driver-journey 02-fees-and-payment 03-integrity-guarantees; do
  npx tsx "demo/${demo}.ts"
done

#!/bin/bash
# usage: runsuite.sh <outdir> [extra model args...]
out=${1:?usage: runsuite.sh <outdir> [extra model args...]}; shift
mkdir -p "$out"
# Resolved before the cd below, so a relative <outdir> means the caller's directory.
OUTDIR=$(cd "$out" && pwd); export OUTDIR
EXTRA="$*"; export EXTRA
cd "$(dirname "$0")" || exit 1
python3 -c 'import codeworks_model as m; [print(v+"|"+b) for v,b in m.SUITE]' | \
  xargs -P 3 -I{} bash -c 'v=${1%%|*}; b=${1#*|}; f="$OUTDIR/${v}_${b//[=,]/_}.txt"; timeout 5400 python3 codeworks_model.py --variant "$v" --budget "$b" --limit 7000000 $EXTRA > "$f" 2> "$f.err"; echo "$f exit $?"' _ {}

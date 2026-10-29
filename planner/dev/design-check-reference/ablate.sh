#!/bin/bash
# usage: ablate.sh <outdir>; runs "--fix all minus X" for every fix X on the scenario that exercises it
out=${1:?usage: ablate.sh <outdir>}
mkdir -p "$out"
# Resolved before the cd below, so a relative <outdir> means the caller's directory.
OUTDIR=$(cd "$out" && pwd); export OUTDIR
cd "$(dirname "$0")" || exit 1
ALL=$(python3 -c 'import codeworks_model as m; print(",".join(sorted(m.ALL_FIXES)))'); export ALL
cat <<'LIST' | xargs -P 3 -L 1 bash -c 'x=$0; v=$1; b=$2; fx=$(echo "$ALL" | tr , "\n" | grep -vx "$x" | paste -sd,); timeout 3600 python3 codeworks_model.py --variant $v --budget "$b" --fix "$fx" --limit 7000000 > "$OUTDIR/minus_$x.txt" 2>/dev/null; echo "$x exit $?"'
K1 one resc=1
K12 one dis=1
S3 one dis=0
S4 one dis=0
S5 two crash=1
S9 one dis=0
T9 new dis=0
L4 one resc=1
L6 two reo=1
SIL one dis=0
GHR one dis=0
LB one dis=0
WV one dis=0
LOCK one dis=1
SC one dis=1
PLW one resc=1
S2 one resc=1
UNL one resc=1
T7 one dis=1
OUT two ext=1,outs=1
LIST

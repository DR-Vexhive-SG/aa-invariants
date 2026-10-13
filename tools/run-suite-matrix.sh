#!/usr/bin/env bash
# Run a target project's suites ONE PER MOCHA INVOCATION to get a per-suite
# matrix: a suite that kills the process must not hide the results of the
# others (in a single invocation, an early crash swallows the rest).
#
# Usage:
#   TARGET=/path/to/aa-project tools/run-suite-matrix.sh
#   TARGET=/path/to/aa-project tools/run-suite-matrix.sh 'test/tokenless-*.test.oscript.js'
#
# NODE: see SETUP.md — native modules must be loaded by the SAME Node ABI that
# built them. Point NODE at that interpreter (e.g. /usr/bin/node-22).
set -uo pipefail

TARGET="${TARGET:?set TARGET=/path/to/aa-project}"
NODE="${NODE:-/usr/bin/node-22}"
GLOB="${1:-test/*.test.oscript.js}"
LOG="${LOG:-$TARGET/suite-matrix.log}"

cd "$TARGET" || exit 1
: > "$LOG"
echo "start $(date -u +%FT%TZ) · node=$("$NODE" --version)" >> "$LOG"

for f in $GLOB; do
	echo "=== $f" >> "$LOG"
	timeout 420 "$NODE" node_modules/mocha/bin/_mocha --exit --slow 20000 \
		--require test/bootload.js --reporter spec "$f" >> "$LOG" 2>&1
	echo "RC=$? · $f" >> "$LOG"
done

echo "end $(date -u +%FT%TZ)" >> "$LOG"
echo "matrix written to $LOG"

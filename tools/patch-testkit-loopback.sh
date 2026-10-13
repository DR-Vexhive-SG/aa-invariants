#!/usr/bin/env bash
# aa-testkit 0.3.x dials the hub at 127.0.0.1 by default. On hosts whose
# firewall drops IPv4 loopback traffic (e.g. firewalld rejecting all loopback
# IPv4), the devnet never forms: the hub logs "0 incoming connections" and
# witnesses never sync, while sockets ARE listening. This script points the
# five dial points to [::1] instead — a local, unprivileged workaround.
#
# Run from the target project root, after `npm install`.
# Reinstalling node_modules resets this: just re-run the script.
#
# Better long-term fix (upstream): make the hub host configurable in aa-testkit.
set -euo pipefail

FILES=(
	"node_modules/aa-testkit/src/nodes/GenesisNode/GenesisNode.js"
	"node_modules/aa-testkit/src/nodes/HeadlessWallet/HeadlessWallet.js"
	"node_modules/aa-testkit/src/nodes/ObyteExplorer/ObyteExplorer.js"
	"node_modules/aa-testkit/src/nodes/ObyteWitness/ObyteWitness.js"
	"node_modules/aa-testkit/src/networks/lib/NetworkFromGenesis.js"
)

missing=0
for f in "${FILES[@]}"; do
	[ -f "$f" ] || { echo "MISSING: $f   (run from the project root, after npm install)"; missing=1; continue; }
	sed -i 's/127\.0\.0\.1:\${config\.NETWORK_PORT}/[::1]:${config.NETWORK_PORT}/g' "$f"
	patched=$(grep -c '\[::1\]:\${config\.NETWORK_PORT}' "$f" || true)
	printf '%s · [::1] dial points: %s\n' "$f" "$patched"
done

if [ "$missing" -ne 0 ]; then
	echo "Not all files found. Nothing else changed." >&2
	exit 2
fi

cat <<'EOF'
OK: dial points now use [::1].
Diagnose before patching (optional):  ss -ltnp | grep 6611
  and try connecting to 127.0.0.1:6611 vs [::1]:6611 from a small script.
Then run the suite matrix:  tools/run-suite-matrix.sh
EOF

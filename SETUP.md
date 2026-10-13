# SETUP — the two traps that eat hours

## Trap 1: more than one Node installation (native-module ABI)

A machine can have several Node binaries (`nvm`, a distro package, another
`nvm` version) and they are *not* the same: native modules are built against the
ABI of the Node that **installed** them (`npm`), not the one you run later.

Symptom: opaque failures (`std::bad_alloc`, missing bindings) that look like the
dependency's fault.

Diagnose:

```bash
node --version                                  # what your PATH runs
npm exec -c 'node -p process.version'           # what npm installs with
ls /usr/bin/node-*     2>/dev/null
ls ~/.nvm/versions/node 2>/dev/null
```

Rule: pick one interpreter and use it for install **and** run. Example here was
`/usr/bin/node-22` for everything. The matrix runner accepts `NODE=`.

## Trap 2: IPv4 loopback blocked by the firewall (devnet never forms)

aa-testkit 0.3.x dials the hub at `127.0.0.1`. On some hosts the firewall drops
IPv4 loopback traffic while sockets are listening normally. Result: genesis
boots, but the hub logs `0 incoming connections` and witnesses never sync.

Diagnose:

```bash
systemctl is-active firewalld      # or: iptables -S | grep -i loopback
ss -ltnp | grep 6611               # the listener IS there
# connect test (python): 127.0.0.1:6611 vs [::1]:6611
python3 - <<'EOF'
import socket
for host in ('127.0.0.1', '::1'):
    s = socket.socket(socket.AF_INET6 if ':' in host else socket.AF_INET)
    s.settimeout(2)
    try: s.connect((host, 6611)); print(host, 'OK')
    except Exception as e: print(host, 'FAIL', e)
    finally: s.close()
EOF
```

If `[::1]` connects and `127.0.0.1` times out, apply the local workaround:

```bash
tools/patch-testkit-loopback.sh     # run from the project root
```

It rewrites the five dial points inside `node_modules/aa-testkit/src` to `[::1]`.
A reinstall of `node_modules` resets it — re-run the script. The long-term fix
belongs upstream: make the hub host configurable in aa-testkit.

## Running suites

```bash
# one file
/usr/bin/node-22 node_modules/mocha/bin/_mocha --exit --slow 20000 \
  --require test/bootload.js --reporter spec test/<suite>.test.oscript.js

# all, one per invocation (per-suite matrix in suite-matrix.log)
TARGET=$PWD tools/run-suite-matrix.sh
```

`--exit` matters: testkit networks keep handles open and mocha would hang
otherwise. Clean `testdata/runid-*` directories between unrelated runs if you
suspect stale state.

## Devnet sanity probe

Copy `tools/probe-devnet.js` into the project (so `require('aa-testkit')`
resolves) and run it: it should reach `PAYMENT STABLE`. If it hangs before
`GENESIS READY`, you are in Trap 2. If it explodes with a native-module error,
you are in Trap 1.

// Sanity probe: does an aa-testkit devnet actually FORM on this host?
// Genesis boots, a wallet is created, a payment is sent and confirmed.
// If this hangs at "waiting genesis", read SETUP.md (loopback IPv4 / firewall).
//
// Run it from INSIDE the target project (so require('aa-testkit') resolves):
//   /usr/bin/node-22 /path/to/probe_devnet.js
const path = require('path');
const { Testkit } = require('aa-testkit');

const { Network } = Testkit({
	TESTDATA_DIR: path.join(__dirname, '../testdata'),
	NETWORK_PORT: 6611,
});

(async () => {
	try {
		console.log('PROBE: creating network...');
		const network = await Network.create().run();
		console.log('PROBE: network launched, waiting for genesis...');
		const genesis = await network.getGenesisNode().ready();
		console.log('PROBE: GENESIS READY');

		const wallet = await network.newHeadlessWallet().ready();
		const address = await wallet.getAddress();
		console.log('PROBE: wallet =', address);

		const { unit } = await genesis.sendBytes({ toAddress: address, amount: 1000000 });
		console.log('PROBE: unit sent =', unit);
		await network.witnessUntilStable(unit);
		console.log('PROBE: PAYMENT STABLE (the network works)');

		await network.stop();
		console.log('PROBE: OK');
		process.exit(0);
	}
	catch (e) {
		console.error('PROBE FAILED:', e && e.message ? e.message : e);
		process.exit(1);
	}
})();

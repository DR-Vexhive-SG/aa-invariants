/*
 * aa-invariants — independent invariant battery for Obyte-style AAs.
 * Author: Vexhive (autonomous agent). License: MIT. See README.md.
 *
 * WHY THIS EXISTS
 *   A project's own suite usually compares the real AA against a JS model
 *   written by the same authors. If model and AA share one wrong assumption,
 *   the tests pass while the invariant is broken. These probes check
 *   invariants that do NOT come from that model: conservation of funds,
 *   a strictly lossy round trip, no negative reserves, no state move on a
 *   bounce.
 *
 * METHOD NOTES (learned the hard way; see README "Method rules")
 *   1. An assertion that passes while the AA did nothing is not evidence:
 *      every case below asserts the state TRANSITION it expects.
 *   2. Anchor the round-trip measurement at the wallet balance BEFORE the
 *      initial purchase, not right before the sell.
 *   3. A bounce must be read from the AA response (`response.bounced` and its
 *      error), not inferred from the absence of an exception.
 *
 * HOW TO RUN
 *   Copy this file into a subdirectory of the target aa-testkit project
 *   (e.g. ./mytests/) so that  ../aa-lib.oscript, ../agent-tokenless.oscript
 *   and ../factory.oscript  resolve to the target's agents. Then run it with
 *   mocha from the project root (see README / SETUP.md).
 */

const { expect } = require('chai');
const path = require('path');
const moment = require('moment');

const show = (tag, o) => console.log('    [VEXHIVE] ' + tag + ' :: ' + JSON.stringify(o));
const alive = (r) => {
	try {
		const x = r.response.response;
		return { bounced: r.response.bounced, responseVars: x.responseVars, error: x.error, msg: x.error && x.error.message };
	} catch (e) { return { no_response: e.message }; }
};

describe('VEXHIVE AA invariant battery (independent of the project model)', function () {
	this.timeout(240000);

	let network, alice, aliceAddress, oracleOperator, oracleOperatorAddress, factory, addr;
	let tokens;   // amount bought by alice
	let bInitial; // alice base balance BEFORE the purchase (round-trip anchor)
	const eventDate = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

	const vars = async () => (await alice.readAAStateVars(addr)).vars;
	const baseBalance = async () => { const b = await alice.getBalance(); return b.base.total; };
	const internalBalance = (v) => (v['balance_' + aliceAddress] || { yes: 0 }).yes;

	before(async () => {
		network = await Network.create()
			.with.agent({ aaLib: path.join(__dirname, '../aa-lib.oscript') })
			.with.agent({ predictionBaseAgent: path.join(__dirname, '../agent-tokenless.oscript') })
			.with.agent({ predictionFactoryAgent: path.join(__dirname, '../factory.oscript') })
			.with.wallet({ alice: { base: 50e9 } })
			.with.wallet({ oracleOperator: 10e9 })
			.run();

		alice = network.wallet.alice;
		aliceAddress = await alice.getAddress();
		oracleOperator = network.wallet.oracleOperator;
		oracleOperatorAddress = await oracleOperator.getAddress();
		factory = network.agent.predictionFactoryAgent;

		const { unit, error } = await alice.triggerAaWithData({
			toAddress: factory,
			amount: 20000,
			data: {
				event: 'invariant battery',
				oracle: oracleOperatorAddress,
				comparison: '==',
				feed_name: 'FEED_NAME',
				datafeed_value: 'YES',
				event_date: moment.unix(eventDate).utc().format('YYYY-MM-DDTHH:mm:ss'),
				waiting_period_length: 3 * 24 * 3600,
				reserve_asset: 'base',
				arb_profit_tax: 0.9,
				issue_fee: 0.01,
				redeem_fee: 0.02,
				is_tokenless: true
			}
		});
		expect(error).to.be.null;
		expect(unit).to.be.validUnit;

		const { response } = await network.getAaResponseToUnitOnNode(alice, unit);
		expect(response.bounced).to.be.false;
		addr = response.response.responseVars.prediction_address;
		expect(addr).to.be.validAddress;
		console.log('    [VEXHIVE] market =', addr);

		// Initial purchase: 1e9 base plus network fee (the project-suite pattern)
		bInitial = await baseBalance();
		const buy = await alice.triggerAaWithData({ toAddress: addr, amount: 1e9 + 1e4, data: { type: 'yes' } });
		expect(buy.error).to.be.null;
		await network.witnessUntilStable(buy.unit);
		const r1 = await network.getAaResponseToUnitOnNode(alice, buy.unit);
		show('buy ->', alive(r1));
		tokens = r1.response.response.responseVars.yes_amount;
		expect(tokens, 'the purchase must return a token amount').to.be.a('number');
		const v = await vars();
		show('vars after BUY', v);
		expect(internalBalance(v), 'internal balance must reflect the purchase').to.be.equal(tokens);
	});

	it('I1: partial sell — the pool must not lose funds and the round trip must be strictly lossy', async () => {
		console.log('    [VEXHIVE] --- I1 starts');
		const b0 = await baseBalance();
		const v1 = await vars();
		const r0 = v1.reserve;

		const half = Math.floor(tokens / 2);
		const sell = await alice.sendMulti({
			base_outputs: [{ address: addr, amount: 1e4 }],
			messages: [{ app: 'data', payload: { yes_amount: -half } }]
		});
		expect(sell.error).to.be.null;
		await network.witnessUntilStable(sell.unit);
		const r2 = await network.getAaResponseToUnitOnNode(alice, sell.unit);
		show('partial sell ->', alive(r2));
		expect(r2.response.bounced, 'the partial sell must enter (not bounce)').to.be.false;

		const v2 = await vars();
		const b2 = await baseBalance();
		show('vars after PARTIAL SELL', v2);
		show('alice base', { before: b0, after: b2, delta: b2 - b0 });

		// LIVENESS: the internal balance dropped exactly by the amount sold
		expect(internalBalance(v2), 'the sell must reduce the internal balance').to.be.equal(tokens - half);
		// POOL: the reserve paid out but cannot go negative
		expect(v2.reserve, 'the reserve cannot grow after a sell').to.be.below(r0);
		expect(v2.reserve, 'the reserve cannot go negative').to.be.at.least(0);
		// USER: anchor = balance BEFORE the purchase (bInitial), not b0.
		// The full round trip must cost money (strict) and cannot cost more
		// than what was sent (1e9 + network fee).
		show('full round trip', { bInitial, b2, loss: b2 - bInitial });
		expect(b2, 'the round trip must be strictly lossy').to.be.below(bInitial);
		expect(b2, 'the round trip cannot cost more than what was sent').to.be.above(bInitial - (1e9 + 1e4));
	});

	it('I2: full-supply exit — outcome is MEASURED; if it bounces, state must not move', async () => {
		console.log('    [VEXHIVE] --- I2 starts');
		const v1 = await vars();
		const before = JSON.stringify(v1);

		const remaining = internalBalance(v1); // after I1: tokens - half
		expect(remaining, 'there must be a position to sell').to.be.above(0);

		const sell = await alice.sendMulti({
			base_outputs: [{ address: addr, amount: 1e4 }],
			messages: [{ app: 'data', payload: { yes_amount: -remaining } }]
		});
		expect(sell.error).to.be.null;
		await network.witnessUntilStable(sell.unit);
		const r2 = await network.getAaResponseToUnitOnNode(alice, sell.unit);
		show('full exit ->', alive(r2));

		if (r2.response.bounced) {
			console.log('    [VEXHIVE] I2 outcome: BOUNCED (msg=' + (r2.response.response.error.message || 'n/a') + ') — state must be unchanged');
			if (r2.response.response.error && r2.response.response.error.trace) {
				show('bounce trace', r2.response.response.error.trace);
			}
			const v2 = await vars();
			expect(JSON.stringify(v2), 'a bounce must not move state').to.be.equal(before);
		} else {
			const v2 = await vars();
			console.log('    [VEXHIVE] I2 outcome: ENTERED');
			show('vars after FULL EXIT', v2);
			expect(internalBalance(v2), 'an entered full exit must zero the internal balance').to.be.equal(0);
		}
	});

	it('I3: sell everything EXCEPT the last token, then attempt the last token', async () => {
		console.log('    [VEXHIVE] --- I3 starts');
		const v1 = await vars();
		const remaining = internalBalance(v1);
		if (remaining < 2) {
			console.log('    [VEXHIVE] I3 skipped: fewer than 2 tokens left (' + remaining + ')');
			this.skip();
		}

		// all but the last one
		const before1 = JSON.stringify(v1);
		const sell1 = await alice.sendMulti({
			base_outputs: [{ address: addr, amount: 1e4 }],
			messages: [{ app: 'data', payload: { yes_amount: -(remaining - 1) } }]
		});
		expect(sell1.error).to.be.null;
		await network.witnessUntilStable(sell1.unit);
		const r1 = await network.getAaResponseToUnitOnNode(alice, sell1.unit);
		show('sell all but 1 ->', alive(r1));
		if (r1.response.bounced) {
			console.log('    [VEXHIVE] I3 outcome (all but 1): BOUNCED — state must be unchanged');
			const v1b = await vars();
			expect(JSON.stringify(v1b), 'a bounce must not move state').to.be.equal(before1);
			this.skip();
		}

		const v2 = await vars();
		show('vars with 1 token inside', v2);
		expect(internalBalance(v2), 'exactly 1 token must remain in the internal balance').to.be.equal(1);

		// the last token
		const before2 = JSON.stringify(v2);
		const sell2 = await alice.sendMulti({
			base_outputs: [{ address: addr, amount: 1e4 }],
			messages: [{ app: 'data', payload: { yes_amount: -1 } }]
		});
		expect(sell2.error).to.be.null;
		await network.witnessUntilStable(sell2.unit);
		const r2 = await network.getAaResponseToUnitOnNode(alice, sell2.unit);
		show('last token ->', alive(r2));
		if (r2.response.bounced) {
			console.log('    [VEXHIVE] I3 outcome (last token): BOUNCED — state must be unchanged');
			const v3 = await vars();
			expect(JSON.stringify(v3), 'the bounce must not move state').to.be.equal(before2);
			show('final vars', v3);
		} else {
			const v3 = await vars();
			console.log('    [VEXHIVE] I3 outcome (last token): ENTERED');
			show('final vars', v3);
		}
	});

	it('I4: round-trip pulse — measures whether reserve-vs-curve deviation is extractable', async () => {
		console.log('    [VEXHIVE] --- I4 starts');
		const v1 = await vars();
		const ss = v1.supplies;
		const curve = Math.ceil(v1.coef * Math.sqrt(ss.yes * ss.yes + ss.no * ss.no + ss.draw * ss.draw));
		show('I4 starting state', { reserve: v1.reserve, curve, deviation: v1.reserve - curve, coef: v1.coef });
		const b1 = await baseBalance();

		// pulse: buy 1 token, then sell it right away
		const buy = await alice.triggerAaWithData({ toAddress: addr, amount: 6e6, data: { yes_amount: 1 } });
		expect(buy.error).to.be.null;
		await network.witnessUntilStable(buy.unit);
		const rb = await network.getAaResponseToUnitOnNode(alice, buy.unit);
		show('pulse buy ->', alive(rb));
		expect(rb.response.bounced, 'the pulse buy must enter').to.be.false;

		const sell = await alice.sendMulti({
			base_outputs: [{ address: addr, amount: 1e4 }],
			messages: [{ app: 'data', payload: { yes_amount: -1 } }]
		});
		expect(sell.error).to.be.null;
		await network.witnessUntilStable(sell.unit);
		const rs = await network.getAaResponseToUnitOnNode(alice, sell.unit);
		show('pulse sell ->', alive(rs));
		expect(rs.response.bounced, 'the pulse sell must enter').to.be.false;

		const b2 = await baseBalance();
		const v2 = await vars();
		const curve2 = Math.ceil(v2.coef * Math.sqrt(v2.supplies.yes * v2.supplies.yes + v2.supplies.no * v2.supplies.no + v2.supplies.draw * v2.supplies.draw));
		show('I4 pulse result', {
			base_before: b1, base_after: b2, net: b2 - b1,
			reserve_before: v1.reserve, reserve_after: v2.reserve,
			curve_after: curve2, tokens: v2.supplies.yes
		});
		show('I4 deviation after pulse', { reserve: v2.reserve, curve: curve2, deviation: v2.reserve - curve2 });

		// READING: the pulse must not profit. If it does, there is measurable
		// extraction from the pool. (Measurement, not assertion: this line is
		// the output of the battery.)
		console.log('    [VEXHIVE] *** I4 verdict: ' + ((b2 - b1) > 0 ? 'EXTRACTION MEASURED net=' + (b2 - b1) : 'no extraction (net ' + (b2 - b1) + ')'));
	});
});

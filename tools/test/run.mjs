/**
 * @file tools/test/run.mjs 
 * @version 1.0.0
 * Runs every pure-logic unit test and prints one summary. Zero dependencies.
 *
 *   node tools/test/run.mjs
 *
 * Exits non-zero if any check fails (CI-friendly). Add new suites by importing
 * their default export and listing it in SUITES below.
 */
import { makeHarness, report } from './_harness.mjs';
import sim from './sim.test.mjs';
import simStatus from './sim-status.test.mjs';
import draft from './draft.test.mjs';
import engine from './engine.test.mjs';
import mprules from './mp-rules.test.mjs';
import identity from './identity.test.mjs';
import catchTracker from './catch-tracker.test.mjs';
import share from './share.test.mjs';

const SUITES = [['sim', sim], ['sim-status', simStatus], ['draft', draft], ['engine', engine], ['mp-rules', mprules], ['identity', identity], ['catch-tracker', catchTracker], ['share', share]];

const t = makeHarness();
for (const [name, fn] of SUITES) {
  try { await fn(t); }
  catch (e) { t.ok(false, `${name} suite threw: ${e && e.stack || e}`); }
}
const passed = report(t);
process.exit(passed ? 0 : 1);

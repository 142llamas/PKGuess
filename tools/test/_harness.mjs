/** 
 * @file tools/test/_harness.mjs
 * @version 1.0.0
 * Minimal zero-dependency assertion harness for the pure-logic unit tests.
 * Each *.test.mjs default-exports a function that takes the harness `t` and runs
 * its checks. `run.mjs` imports them all and prints one summary.
 */
export function makeHarness() {
  const state = { pass: 0, fail: 0, failures: [], section: '' };
  const t = {
    section(name) { state.section = name; console.log(`\n— ${name}`); },
    ok(cond, msg) {
      if (cond) { state.pass++; }
      else { state.fail++; state.failures.push(`[${state.section}] ${msg}`); console.log('   FAIL: ' + msg); }
    },
    eq(a, b, msg) { this.ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); },
    note(msg) { console.log('   · ' + msg); },
  };
  t._state = state;
  return t;
}
export function report(t) {
  const s = t._state;
  console.log(`\n${'='.repeat(48)}\n${s.pass} passed, ${s.fail} failed`);
  if (s.fail) { console.log('\nFailures:'); for (const f of s.failures) console.log('  - ' + f); }
  return s.fail === 0;
}

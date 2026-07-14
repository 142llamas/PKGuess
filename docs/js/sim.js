/**
 * PokeGuess — Draft Battle simulator (core)
 * ---------------------------------------------------------------------------
 * A deliberately SIMPLIFIED but faithful facsimile of a Gen 1 / Gen 2 battle.
 * It exists to decide who wins a fight between two "Frankenstein" drafted
 * Pokemon (arbitrary stats / types / moves), fast and deterministically, so the
 * UI can replay one battle step-by-step while the real outcome is a win-% taken
 * over many silent simulations.
 *
 * @version 2.11.0
 * @changelog
 *   2.11.0 — "Simplified moves" pass complete: SUBSTITUTE (requested). Spends
 *           1/4 max HP to create a decoy with 1/4 max HP + 1 (fails if a sub is
 *           already up or HP ≤ cost). While the sub stands, incoming damage is
 *           routed to it (applyDamageToDefender), and gen-2 excess damage does
 *           NOT carry over on break. A `hadSub` snapshot taken when the move
 *           connects blocks every defender-targeting side-effect that turn —
 *           status, confusion, flinch, stat drops, Leech Seed, trapping — even
 *           if the sub breaks from the same hit; the attacker's own self-boost
 *           secondary still procs. Residual chip (poison/burn/Leech/sand/trap/
 *           nightmare/curse) still hits the mon behind the sub. New sub/
 *           sub-damage/sub-break events. DISCLOSED simplifications: drain/recoil
 *           use the computed damage rather than the amount the sub actually
 *           absorbed (minor over-heal/recoil when overkilling a sub); Pain Split
 *           ignores the sub and averages real HP; confusion self-hit strikes the
 *           mon, not its own sub. This closes the simplified-moves list — every
 *           draftable move now behaves per gen-2 (within the switchless-1v1
 *           scope), with only the documented approximations remaining.
 *   2.10.0 — "Simplified moves" pass, Mist + Weather (requested). MIST: un-
 *           banned; 5-turn protection blocking any opponent-induced stat drop
 *           (applyFoeBoosts filters negative components while mistTurns > 0);
 *           positive foe-target boosts, self-boosts, and self-drops are
 *           unaffected. WEATHER: field-level state (weather + weatherTurns)
 *           threaded through doMove/calcDamage/endOfTurn. Rain Dance/Sunny Day/
 *           Sandstorm each last 5 turns. Rain: Water ×1.5, Fire ×0.5, Thunder
 *           can't miss, Synthesis-family heal 1/4. Sun: Fire ×1.5, Water ×0.5,
 *           Solar Beam fires instantly (no charge turn), Thunder acc → 50,
 *           Synthesis-family heal 2/3. Sandstorm: 1/16 max-HP end-of-turn chip
 *           to anything not Rock/Ground/Steel (gen-2 sandstorm does NOT boost
 *           Rock Sp.Def — that's gen 4). New events: mist/mist-block/mist-end,
 *           weather-start/weather-end, sandstorm chip. Heal Bell & Psych Up
 *           banned in draft.js instead of modeled (tiny wins, per request).
 *           DISCLOSED: Solar Beam's power reduction in rain/sand is not modeled
 *           (only the sun instant-charge is); no weather-setting held items
 *           (5-turn fixed duration). Substitute is the last simplified move
 *           still to do.
 *   2.9.0 — "Simplified moves" pass, batch A/B (requested). Bone Rush: was
 *           firing as a single 25-bp hit; now the real 2–5 multi-hit. Low Kick:
 *           added its 30% flinch — and a correction to an earlier assumption,
 *           Low Kick is NOT weight-based in gen 1/2 (that's gen 3+), so it's
 *           just flat power + flinch, no weight data needed. Return/Frustration:
 *           data base power 50→102 (each move's power at its own optimal
 *           happiness — the standard assumption in a context with no happiness
 *           stat; disclosed). Trapping moves (Wrap/Bind/Fire Spin/Clamp/
 *           Whirlpool): a connecting hit now binds the target for 2–5 turns of
 *           1/16 max-HP chip (TRAP_FRACTION), via a `trap` move flag +
 *           `trappedTurns` state + endOfTurn chip; the "can't switch" half is
 *           moot in a switchless 1v1 but the residual chip is real. New `trap`/
 *           `trap-end` events. (Batches C–E — Heal Bell, Psych Up, Substitute,
 *           Weather — still to come.)
 *   2.8.0 — Tier-3: "rampage" moves OUTRAGE / THRASH / PETAL DANCE (requested).
 *           Each locks the user into repeating it for 2–3 turns (forced via the
 *           same chooseMoveForTurn mechanism as Rollout's lock), then the user
 *           is confused from fatigue. Lock starts on first use (set before any
 *           early return, so a missed/blocked/immune rampage turn still counts);
 *           tickRampage() runs from the turn loop after the user acts, so it
 *           advances on every path the move took. New `rampage` move flag,
 *           `rampageMove`/`rampageTurns` state, `rampage-start`/`rampage-end`
 *           events. Disclosed simplifications: the lock only advances on turns
 *           the user actually acts (a disruption like paralysis/sleep pauses
 *           rather than ends it), and the fatigue confusion is self-inflicted so
 *           it ignores the user's own Safeguard.
 *   2.7.0 — Tier-3 (partial): SNORE implemented (requested rule of thumb —
 *           implement if clean, else ban). Usable ONLY while the user is
 *           asleep: preMove now takes the chosen move, and a sleeping mon that
 *           picks Snore acts (dealing 40 bp + 30% flinch) instead of skipping,
 *           WITHOUT ending its sleep early — the "N sleep turns = N ticks"
 *           invariant is preserved (guarded by a dedicated test). An awake
 *           Snore fails (requiresSelfAsleep guard in doMove, mirroring Dream
 *           Eater's target-asleep guard). New `asleep-acts` event. Snore's
 *           data base power was corrected 50→40 to match real gen-2. Sleep
 *           Talk, Future Sight, Disable, and Encore remain OUT — banned in
 *           draft.js rather than modeled (Sleep Talk needs nested random-move
 *           execution while asleep; Future Sight needs a delayed-hit timing
 *           system) — flagged as deliberate scope calls, not gaps.
 *   2.6.0 — Tier-2 move-audit batch (requested). Destiny Bond was moved to
 *           draft.js's BANNED_DRAFT_MOVES (per request) rather than modeled;
 *           Mind Reader was already banned, so Lock-On is the only member of
 *           that pair implemented here.
 *             • Nightmare: fails unless the target is asleep; then chips 1/4
 *               max HP every end-of-turn until they wake (the wake path clears
 *               it). New `nightmared` flag + `nightmare-end` event.
 *             • Safeguard: 5-turn side status immunity for the user. Blocks
 *               all major status AND confusion (confusion is applied directly,
 *               not via tryStatus, so both the guaranteed and secondary
 *               confuse paths were guarded too). New `safeguardTurns` state,
 *               `safeguard`/`safeguard-block`/`safeguard-end` events.
 *             • Lock-On / Mind Reader: the user's NEXT move can't miss —
 *               skips the accuracy/evasion roll AND hits through Fly/Dig
 *               semi-invulnerability (full real behavior, per request). One-
 *               shot `lockedOn` flag consumed by the next move; `lockon`/
 *               `lockon-hit` events.
 *             • Fury Cutter / Rollout: power DOUBLES per consecutive
 *               successful hit, capped at ×16 (RAMP_MAX_DOUBLINGS = 4, the
 *               gen-2 5-hit cap). The chain resets on a miss, a Protect block,
 *               a semi-invuln whiff, a type-immune 0-damage hit, or the user
 *               switching moves (all routed through breakRamp()). Rollout
 *               additionally LOCKS the user into repeating it for the 5-hit
 *               sequence (per request — forced via chooseMoveForTurn, the same
 *               mechanism as charge/recharge; this is the reusable forced-move
 *               scaffold the Tier-3 Outrage/Thrash/Petal Dance will build on).
 *               New `ramp`/`rolloutLock` move flags, `rampMoveId`/`rampStreak`/
 *               `rolloutMove`/`rolloutTurns` state, `ramp` event. DISCLOSED:
 *               Fury Cutter's data base power is 40 (cartridge gen-2 is 10) —
 *               not overridden, since bp is data-driven everywhere; only the
 *               ramp mechanic is added, so its absolute numbers run hot.
 *               Defense Curl's Rollout-power doubling is not modeled.
 *             • Fly/Dig semi-invulnerability exceptions: Gust/Twister now hit
 *               a mid-Fly target and Earthquake/Magnitude a mid-Dig target,
 *               each for DOUBLE damage (threaded through calcDamage's new
 *               optional extraMul param). Previously invulnThisTurn blocked
 *               everything with no exceptions.
 *   2.5.0 — Tier-1 move-audit batch (requested): cross-referenced all 244
 *           moves in movestats-gen2.json against MOVE_EFFECTS directly (not
 *           the changelog prose) to find real gaps. Also cross-checked
 *           against draft.js's BANNED_DRAFT_MOVES — Explosion/Self-Destruct,
 *           Sweet Scent, Sky Attack, and False Swipe turned out to already be
 *           unreachable in any real draft (banned from the pool, including
 *           Smeargle's Sketch pool via draftpool-gen2.json going through the
 *           same buildLearnsetMap() filter), so those were dropped from this
 *           batch rather than "fixed" for dead code.
 *             • Dynamicpunch: added its real 100% guaranteed confuse on hit
 *               (was plain damage).
 *             • Mud-Slap / Octazooka: added their real target-accuracy-drop
 *               secondaries (100% / 40%) — meaningful now that accuracy
 *               stages are modeled (2.4.0); previously plain damage.
 *             • Bone Club: added its 10% flinch secondary (was missing).
 *             • Endure: was a complete no-op despite already carrying correct
 *               prio:4 in the base data. Now guarantees survival at 1 HP
 *               against the turn's incoming hit (self-inflicted recoil/crash/
 *               curse-cost are NOT covered — Endure blocks the opponent's
 *               attack, not your own move's drawback). New `enduring` flag,
 *               cleared every endOfTurn (before residual chip damage, so
 *               poison/burn/Leech Seed can still finish off an Endure-saved
 *               mon on the same turn — Endure only blocks the attack itself).
 *             • Protect / Detect: same story — correct prio:4, zero effect.
 *               Now blocks any incoming move that would actually affect the
 *               defender (damage, guaranteed/secondary status, Curse, Leech
 *               Seed, Pain Split, Haze). Self-only moves (Rest/Belly Drum/
 *               Reflect/Light Screen/Endure, and any generic self-targeted
 *               boost like Swords Dance) aren't blocked since they never
 *               touch the defender. Disclosed simplification: Curse's
 *               non-Ghost branch is a pure self-buff that doesn't strictly
 *               need blocking, but is blocked anyway rather than special-
 *               cased further — a harmless over-block in a rare edge case.
 *               New `protecting` flag, same one-turn lifecycle as `enduring`.
 *             • Haze: resets ALL stat stages (atk/def/spa/spd/spe/acc/eva) to
 *               0 for BOTH combatants. Was a complete no-op.
 *   2.4.0 — Accuracy/evasion stages + speed-mechanics pass (requested):
 *             • ACCURACY & EVASION are now modeled as ±6 stages, using the
 *               gen-2 table (multiplier = (3+stage)/3 for +, 3/(3-stage) for -,
 *               i.e. 1.0 at 0, up to 3.0 at +6, down to ~0.33 at -6). Hit chance
 *               = move.acc/100 × accStageMul(attacker.acc) × accStageMul(-def.eva).
 *               A 100%-accuracy move can now miss a foe that raised evasion,
 *               and a sub-100 move can be made more reliable. This makes the
 *               previously-no-op moves real: Double Team / Minimize (+evasion),
 *               Sand-Attack / Smokescreen / Flash / Kinesis (-target accuracy).
 *               (This reverses 2.3.0's note that accuracy/evasion were out of
 *               scope — it was explicitly requested with the gen-2 formula.)
 *             • Icy Wind now applies its real 100% Speed-drop secondary (a
 *               damaging move that also lowers the target's Speed every hit),
 *               and Bubble/Bubblebeam their 10% Speed-drop secondary. Combined
 *               with the already-correct speed-stage handling, this means moves
 *               like Icy Wind / Agility change turn order for the rest of the
 *               battle, while priority moves (Quick Attack +1, Extreme Speed
 *               +2, Mach Punch +1) win the current turn regardless of Speed.
 *               (Both were verified already-correct; only the Icy Wind/Bubble
 *               data was missing.)
 *             • A guaranteed target boost on a DAMAGING move (e.g. Icy Wind)
 *               now only applies when the hit actually connected (a type-immune
 *               no-op no longer still drops the target's stat); pure Status
 *               moves are unaffected.
 *   2.3.0 — Battle-mechanics bug-fix + deep-dive pass (requested):
 *             • SLEEP fix (reported bug: "put to sleep 4x but only asleep 1
 *               turn total"). A sleeping mon was waking AND acting on the same
 *               turn its counter hit 0, so a 1-turn sleep cost 0 missed turns.
 *               Now a sleeping mon always skips its turn while the counter is
 *               > 0 and wakes at the START of a later turn once it has expired
 *               — sleep of N turns = N missed turns. (Rest, a fixed 2-turn
 *               sleep, now correctly costs exactly 2 turns.)
 *             • REFLECT and LIGHT SCREEN were entirely absent from the effects
 *               table (they resolved as no-op status moves — "16 dmg before
 *               and after Reflect"). Implemented both: 5-turn side screens that
 *               halve incoming physical (Reflect) / special (Light Screen)
 *               damage, bypassed by crits (authentic Gen 2), with end-of-turn
 *               expiry. Added reflectTurns/lightScreenTurns combatant state.
 *             • Deep-dive audit of the rest of the engine confirmed working:
 *               all status moves (Thunder Wave/Toxic/Spore/Confuse Ray/Glare/
 *               etc.), all secondary-effect procs (Body Slam para, Flamethrower
 *               burn, Ice Beam freeze, Bite flinch, Psychic/Crunch drops), and
 *               all stat-stage moves (Swords Dance doubling physical dmg, etc.)
 *               fire with correct numbers. Will-O-Wisp is correctly ABSENT (a
 *               Gen 3 move, not in the Gen 2 data). Documented the one genuine
 *               structural gap explicitly in-code: accuracy/evasion STAGES
 *               (Sand-Attack, Smokescreen, Double Team, Minimize, Sweet Scent)
 *               are not modeled, so those moves are deliberate no-ops rather
 *               than half-implemented.
 *   2.2.0 — Move-accuracy pass, requested explicitly after the Fairy-type fix
 *           below prompted a closer look at every previously-disclosed
 *           simplification:
 *             • Magnitude: was a flat listed bp:75. Now rolls the real 4–10
 *               magnitude table every use (MAGNITUDE_TABLE) — this needs no
 *               external stat, so unlike Return/Frustration below it can be
 *               modeled exactly.
 *             • Tri Attack: was simplified to always inflict paralysis on its
 *               20% secondary proc. Now picks randomly among paralysis/burn/
 *               freeze, matching the real move. (secondary.status can now be
 *               an array for a random pick; every other move's plain-string
 *               status is unaffected.)
 *             • Charm: found to have NO effect implemented at all while
 *               investigating the Fairy-type fix below — it was silently a
 *               complete no-op. Added its real -2 Attack drop (twice Growl's
 *               -1, matching its role as the harder-hitting version).
 *             • Fairy type removed entirely (see below) — Charm/Sweet Kiss
 *               retagged Normal, Moonlight retagged Dark, their real pre-Gen-6
 *               types. Confirmed this changes no simulator BEHAVIOR for these
 *               three specifically: type-effectiveness/immunity is only ever
 *               consulted by the damage-calculation path (calcDamage /
 *               calcFixedDamage), and all three are 0-bp status moves that
 *               never reach it — so this is a pure data-accuracy fix, not a
 *               gameplay change.
 *             • Return / Frustration: left as their flat listed base power
 *               (50). Their real formulas are friendship-based
 *               (power = floor(happiness/2.5) and floor((255-happiness)/2.5)
 *               respectively), but there is no friendship stat anywhere in
 *               this draft context to compute from — inventing one would be
 *               an arbitrary guess dressed up as precision, not genuine
 *               accuracy, so this is a structural limitation rather than
 *               something fixed here.
 *             • Jump Kick / High Jump Kick crash damage: left at the existing
 *               1/8 max HP. Looked for a more confident Gen 1/2-specific
 *               figure to replace it with; the only well-established
 *               alternative recalled was Gen 1's separate, genuinely buggy
 *               crash formula (capable of integer underflow) — not something
 *               worth deliberately reintroducing — and no more-confident
 *               Gen 2-specific figure than the existing 1/8 approximation.
 *               Flagging the uncertainty here rather than replacing a
 *               reasonable value with an unverified "precise-looking" one.
 *           Also found and fixed while wiring the above: `sim-status.test.mjs`
 *           (burn/poison/paralysis/confusion/stat-stage verification) had
 *           been written but never registered in tools/test/run.mjs — none of
 *           its assertions had ever actually run as part of `npm test`. Fixed
 *           the registration; all of it passes.
 *   2.1.0 — Fixed a significant bug found during verification: OHKO moves
 *           (Guillotine/Horn Drill/Fissure) were completely non-functional.
 *           They have bp:0 in the base data (their damage isn\'t power-based),
 *           but the damage-dispatch condition required bp>0 before ever
 *           calling the function that checks move.ohko — so even a
 *           successful accuracy roll did nothing at all. Also added a
 *           confuse-end log event (confusion previously had no signal when
 *           it wore off, unlike sleep\'s wake and freeze\'s thaw).
 *   2.0.0 — Real move mechanics (#6). Previously the move-stats data only ever
 *           carried {bp, acc, type, cat, pp, prio} — every move fell through to
 *           plain damage (or a complete no-op for Status moves) regardless of
 *           what the engine's applyBoosts/tryStatus/drain/recoil machinery
 *           could already do with it. Added:
 *             • MOVE_EFFECTS — a curated effects table (recoil/drain/heal
 *               fractions, guaranteed and secondary status, confusion, stat
 *               boosts, OHKO, high-crit, fixed/HP-based damage) merged onto
 *               each move's base data at combatant-build time.
 *             • Multi-hit moves (2–5 with the real 3/8·3/8/1/8/1/8 split, and
 *               fixed-count moves like Double Kick/Twineedle/Triple Kick).
 *             • Two-turn charge moves (Fly/Dig/Solarbeam/Razor Wind/Skull
 *               Bash) — Fly/Dig grant a semi-invulnerable charge turn.
 *             • Recharge moves (Hyper Beam) — a forced do-nothing turn after
 *               use, skipped only if the target faints.
 *             • Special-cased moves whose effect isn't just "boost/status/
 *               drain": Curse (Ghost vs non-Ghost are different moves
 *               entirely), Belly Drum (costs 50% max HP, sets Atk to +6,
 *               fails under half HP), Rest (full heal + cures status +
 *               sleeps exactly 2 turns), Pain Split, Dream Eater (fails
 *               unless the target is asleep), Leech Seed (drains 1/8 max HP
 *               per turn into the seeder; Grass-types immune), and
 *               High/Jump Kick crash damage on a miss.
 *           Known, disclosed simplifications at the time (see 2.2.0 above for
 *           which were later fixed): Magnitude/Return/Frustration used their
 *           flat listed base power rather than the real variable-roll/
 *           friendship formulas; moves reclassified as Fairy-type in later
 *           games (Charm, Sweet Kiss, Moonlight) inherited that typing from
 *           the data pipeline. Also: PP, Substitute, Counter, Transform, trapping
 *           moves, weather/abilities/items remain out of scope, unchanged
 *           from the original design notes below.
 *
 * Design choices (all intentional — see the conversation that produced this):
 *   - Level 100, DV 0, no stat experience. Base stats convert with a fixed rule.
 *   - Moves used each turn are chosen at RANDOM from the mon's 4 (per spec).
 *   - Handles: STAB, per-gen type chart, crits, accuracy/miss, stat stages,
 *     major status (par/brn/psn/tox/slp/frz), flinch, confusion, drain, recoil,
 *     self-heal, high-crit moves, OHKO moves. Anything unrecognised simply deals
 *     damage (or no-ops if it has no base power) — graceful degradation.
 *   - SKIPPED on purpose: PP, trapping, Substitute, Counter, Transform,
 *     weather/abilities/items (none exist in gen 1/2 anyway).
 *   - Gen 1 uses a single Special stat ('spc'); gen 2 splits it ('spa'/'spd').
 *     The damage category of a move is type-based in both gens — that's already
 *     baked into each move's `cat` field by the data generator.
 *
 * No imports: the caller passes in the move-stats map and type chart (loaded
 * from movestats-genN.json / typechart-genN.json), so this module is portable
 * to the browser and trivial to unit-test in Node.
 */

// ---- tunable facsimile constants (named so they're easy to rebalance) -------
const CRIT_RATE = 0.0625;        // base crit chance (~1/16)
const CRIT_RATE_HIGH = 0.25;     // high-crit moves (Slash, Razor Leaf, ...)
const CRIT_MULT = 2.0;           // gen 1/2 crit is x2 (not the modern x1.5)
const STAB = 1.5;
const PARA_SPEED = 0.25;         // paralysis quarters speed
const PARA_FULL = 0.25;          // chance a paralysed mon can't move
const FREEZE_THAW = 0.20;        // chance a frozen mon thaws each turn
const BRN_FRACTION = 1 / 16;     // burn end-of-turn chip
const PSN_FRACTION = 1 / 8;      // poison end-of-turn chip
const TOX_FRACTION = 1 / 16;     // toxic chip, multiplied by counter
const LEECH_SEED_FRACTION = 1 / 8;
const CURSE_CHIP_FRACTION = 1 / 4;
const NIGHTMARE_FRACTION = 1 / 4;   // Tier-2: Nightmare chips 1/4 max HP each turn while asleep
const TRAP_FRACTION = 1 / 16;       // Simplified-moves: Wrap/Bind/etc. chip 1/16 max HP each turn while trapped
const RAMP_MAX_DOUBLINGS = 4;       // Tier-2: Fury Cutter/Rollout cap at ×16 (the gen-2 5-hit cap)
const CONFUSE_SELF = 0.33;       // chance a confused mon hits itself
const CONFUSE_BP = 40;           // self-hit power (typeless physical)
const CRASH_FRACTION = 1 / 8;    // Jump Kick / High Jump Kick miss "crash" damage
// #6 — Magnitude's real random-power table (unchanged since its Gen 2
// introduction). Unlike Return/Frustration this doesn't need any external
// stat to model exactly — it's a pure per-use roll — so it's fully accurate.
const MAGNITUDE_TABLE = [
  { level: 4, chance: 5, bp: 10 },
  { level: 5, chance: 10, bp: 30 },
  { level: 6, chance: 20, bp: 50 },
  { level: 7, chance: 30, bp: 70 },
  { level: 8, chance: 20, bp: 90 },
  { level: 9, chance: 10, bp: 110 },
  { level: 10, chance: 5, bp: 150 },
];
function rollMagnitude(rng) {
  let r = rng() * 100;
  for (const row of MAGNITUDE_TABLE) { r -= row.chance; if (r <= 0) return row; }
  return MAGNITUDE_TABLE[MAGNITUDE_TABLE.length - 1];
}
const DEFAULT_TURN_CAP = 100;
const LEVEL = 100;

// fallback for a move we somehow have no data for: a plain Normal tackle
const FALLBACK_MOVE = { bp: 50, acc: 100, type: 'Normal', cat: 'Physical', pp: 0, prio: 0 };

// Hidden Power: the draft keeps its elemental type in the name, e.g.
// "Hidden Power (Rock)". We borrow base hiddenpower stats but override the type
// (so STAB / effectiveness / immunity are correct) and the damage category,
// which in gen 1/2 is decided by the move's TYPE, not the move itself.
const HP_TYPE_RE = /^hidden power\s*\(([a-z]+)\)/i;
const GEN12_PHYSICAL_TYPES = new Set(['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel']);
const gen12Category = (type) => (GEN12_PHYSICAL_TYPES.has(type) ? 'Physical' : 'Special');

// =============================================================================
// MOVE EFFECTS — the single source of truth for everything the base movestats
// data doesn't carry (#6). Keyed by moveId() (lowercase, alphanumeric-only).
// A move absent from this table just deals plain damage (or is a true no-op
// status move) — exactly as accurate as "no special effect exists".
//
// Shape (all fields optional):
//   recoil:   [num,den]   — attacker takes num/den of damage dealt
//   drain:    [num,den]   — attacker heals num/den of damage dealt
//   heal:     [num,den]   — status move: attacker heals num/den of max HP
//   status:   'par'|'brn'|'psn'|'tox'|'slp'|'frz'  — GUARANTEED on hit (status moves)
//   confuse:  true         — GUARANTEED confuse on hit (status moves)
//   boosts:   {stat:delta} — GUARANTEED stat change (status moves)
//   boostTarget: 'self'|'target' (default 'target' for status moves' boosts)
//   secondary: { chance, status?, flinch?, confuse?, boosts?, selfBoosts? }
//              — chance (0-100) applies AFTER a successful damaging hit
//   multiHit: [lo,hi]      — lo===hi for a fixed count, else weighted 2-5
//   rampBp:   [bp,bp,bp]   — per-hit power for a ramping multi-hit (Triple Kick)
//   ohko:     true
//   highCrit: true
//   fixedDamage: number | 'level' | 'halfhp' | 'psywave'
//   hpBasedPower: true     — Flail/Reversal: power scales with attacker's HP%
//   magnitudeRoll: true    — Magnitude: real random 4–10 roll picks bp (see MAGNITUDE_TABLE), #6
//   twoTurn:  true         — charges turn 1, executes turn 2
//   semiInvuln: true       — (with twoTurn) untargetable during the charge turn
//   recharge: true         — a forced blank turn after use (unless it KOs)
//   crashOnMiss: true      — Jump Kick/High Jump Kick: user takes chip on a miss
//   requiresAsleep: true   — Dream Eater: fails unless the target is asleep
//   special: 'curse'|'bellydrum'|'rest'|'painsplit'|'leechseed'
//            — effects that don't fit the generic fields above at all
// =============================================================================
const MOVE_EFFECTS = {
  // ---- recoil -----------------------------------------------------------
  takedown: { recoil: [1, 4] },
  doubleedge: { recoil: [1, 3] },
  submission: { recoil: [1, 4] },
  jumpkick: { crashOnMiss: true },
  highjumpkick: { crashOnMiss: true },

  // ---- drain --------------------------------------------------------------
  absorb: { drain: [1, 2] },
  megadrain: { drain: [1, 2] },
  gigadrain: { drain: [1, 2] },
  leechlife: { drain: [1, 2] },
  dreameater: { drain: [1, 2], requiresAsleep: true },

  // ---- self-heal status moves ---------------------------------------------
  recover: { heal: [1, 2] },
  softboiled: { heal: [1, 2] },
  milkdrink: { heal: [1, 2] },
  morningsun: { heal: [1, 2], weatherHeal: true },  // weather-scaled: 2/3 sun, 1/4 rain/sand, 1/2 clear
  synthesis: { heal: [1, 2], weatherHeal: true },
  moonlight: { heal: [1, 2], weatherHeal: true },
  rest: { special: 'rest' },
  painsplit: { special: 'painsplit' },
  reflect: { special: 'reflect' },        // halves incoming PHYSICAL damage for 5 turns
  lightscreen: { special: 'lightscreen' }, // halves incoming SPECIAL damage for 5 turns
  // Tier-1 batch (requested audit pass) — all three previously carried correct
  // prio:4 data but had ZERO implementation, i.e. were completely inert moves.
  endure: { special: 'endure' },   // survive the turn's incoming hit at 1 HP
  protect: { special: 'protect' }, // block the turn's incoming hit entirely
  detect: { special: 'protect' },  // same effect as Protect, different name/type
  haze: { special: 'haze' },       // reset ALL stat stages to 0, both sides
  // ---- Tier-2 batch (requested audit pass) ---------------------------------
  nightmare: { special: 'nightmare' },   // fails unless target asleep; then 1/4 max HP chip/turn until they wake
  safeguard: { special: 'safeguard' },   // 5-turn status immunity for the user's side
  lockon: { special: 'lockon' },         // next move by the user can't miss (bypasses accuracy/evasion AND semi-invuln)
  snore: { requiresSelfAsleep: true, secondary: { chance: 30, flinch: true } }, // Tier-3: usable ONLY while the user is asleep; 40 bp + 30% flinch
  // ---- Tier-3: "rampage" moves — lock the user in for 2–3 turns, then the
  // user becomes confused from fatigue. Reuses the same forced-move approach as
  // Rollout's lock (chooseMoveForTurn), but duration-driven (not ramp-driven)
  // and with self-confusion on completion. Disclosed simplifications: the lock
  // runs its full 2–3 turns and only advances on turns the user actually acts
  // (a disruption like paralysis/sleep pauses rather than ends it); the fatigue
  // confusion is self-inflicted and ignores the user's own Safeguard.
  outrage: { rampage: true },
  thrash: { rampage: true },
  petaldance: { rampage: true },
  // ---- "Simplified moves" pass (requested) ---------------------------------
  bonerush: { multiHit: [2, 5] },                    // was firing as a single 25-bp hit; real gen-2 is 2–5 hits
  lowkick: { secondary: { chance: 30, flinch: true } }, // gen 1/2 Low Kick is flat power + 30% flinch (NOT weight-based — that's gen 3+)
  // Trapping moves: damage, then bind the target for 2–5 turns of 1/16 max-HP
  // chip. The "can't switch" half is moot in a switchless 1v1, but the residual
  // chip is real and meaningful. Handled via a `trap` flag consumed after a
  // connecting hit; chip + countdown live in endOfTurn.
  wrap: { trap: true },
  bind: { trap: true },
  firespin: { trap: true },
  clamp: { trap: true },
  whirlpool: { trap: true },
  // Mist: 5-turn protection from opponent-induced stat drops.
  mist: { special: 'mist' },
  // Substitute: spend 1/4 max HP to create a decoy that soaks damage/status.
  substitute: { special: 'substitute' },
  // Weather: 5 turns each. Rain/Sun scale Water/Fire damage and a few move
  // interactions (Solar Beam charge, Thunder accuracy, Synthesis-family heal);
  // Sandstorm chips non-Rock/Ground/Steel 1/16 per turn.
  raindance: { special: 'weather', weatherKind: 'rain' },
  sunnyday: { special: 'weather', weatherKind: 'sun' },
  sandstorm: { special: 'weather', weatherKind: 'sand' },

  // ---- multi-hit (real 3/8, 3/8, 1/8, 1/8 split for 2/3/4/5 hits) ----------
  cometpunch: { multiHit: [2, 5] },
  furyattack: { multiHit: [2, 5] },
  pinmissile: { multiHit: [2, 5] },
  spikecannon: { multiHit: [2, 5] },
  barrage: { multiHit: [2, 5] },
  doubleslap: { multiHit: [2, 5] },
  furyswipes: { multiHit: [2, 5] },
  // fixed-count multi-hit
  doublekick: { multiHit: [2, 2] },
  bonemerang: { multiHit: [2, 2] },
  twineedle: { multiHit: [2, 2], secondary: { chance: 20, status: 'psn' } },
  triplekick: { multiHit: [3, 3], rampBp: [10, 20, 30] },

  // ---- two-turn charge moves ------------------------------------------------
  fly: { twoTurn: true, semiInvuln: true },
  dig: { twoTurn: true, semiInvuln: true },
  solarbeam: { twoTurn: true },
  razorwind: { twoTurn: true, highCrit: true },
  skullbash: { twoTurn: true, boosts: { def: 1 }, boostTarget: 'self' }, // banned from draft, kept for any pre-existing drafted mon

  // ---- recharge -------------------------------------------------------------
  hyperbeam: { recharge: true },

  // ---- OHKO -------------------------------------------------------------
  guillotine: { ohko: true },
  horndrill: { ohko: true },
  fissure: { ohko: true },

  // ---- high crit ratio ----------------------------------------------------
  karatechop: { highCrit: true },
  razorleaf: { highCrit: true },
  slash: { highCrit: true },
  crabhammer: { highCrit: true },
  aeroblast: { highCrit: true },
  crosschop: { highCrit: true },

  // ---- fixed / variable damage formulas ------------------------------------
  sonicboom: { fixedDamage: 20 },
  dragonrage: { fixedDamage: 40 },
  seismictoss: { fixedDamage: 'level' },
  nightshade: { fixedDamage: 'level' },
  superfang: { fixedDamage: 'halfhp' },
  psywave: { fixedDamage: 'psywave' },
  flail: { hpBasedPower: true },
  reversal: { hpBasedPower: true },
  magnitude: { magnitudeRoll: true, hitsDig: true }, // #6 — real random 4–10 roll; also hits (2×) a target mid-Dig
  // ---- Tier-2: ramping-power moves (double per consecutive successful hit) --
  // Base power comes from the data file (the sim's single source of truth for
  // bp everywhere); the ramp DOUBLES it per consecutive hit, capped at 4
  // doublings (the real gen-2 5-hit cap). Disclosed: Fury Cutter's data base
  // is 40, higher than cartridge gen-2's real 10 base — not overridden here,
  // since bp is data-driven throughout; only the ramp MECHANIC is added.
  furycutter: { ramp: true },              // free to switch away; streak resets on miss/other move
  rollout: { ramp: true, rolloutLock: true }, // full behavior: locks the user in for up to 5 turns
  // ---- Tier-2: moves that hit a semi-invulnerable (Fly/Dig) target ----------
  gust: { hitsFly: true },      // hits (2×) a target mid-Fly
  twister: { hitsFly: true, secondary: { chance: 20, flinch: true } }, // (flinch entry moved here from below)
  earthquake: { hitsDig: true }, // hits (2×) a target mid-Dig

  // ---- guaranteed status (status-category moves) ---------------------------
  toxic: { status: 'tox' },
  thunderwave: { status: 'par' },
  stunspore: { status: 'par' },
  glare: { status: 'par' },
  sleeppowder: { status: 'slp' },
  spore: { status: 'slp' },
  hypnosis: { status: 'slp' },
  sing: { status: 'slp' },
  lovelykiss: { status: 'slp' },
  poisonpowder: { status: 'psn' },
  poisongas: { status: 'psn' },
  confuseray: { confuse: true },
  sweetkiss: { confuse: true },
  supersonic: { confuse: true },
  swagger: { confuse: true, boosts: { atk: 2 }, boostTarget: 'target' }, // raises the TARGET's attack, then confuses them
  flatter: { confuse: true, boosts: { spa: 1 }, boostTarget: 'target' },
  leechseed: { special: 'leechseed' },
  curse: { special: 'curse' },
  bellydrum: { special: 'bellydrum' },

  // ---- guaranteed self stat boosts -----------------------------------------
  swordsdance: { boosts: { atk: 2 }, boostTarget: 'self' },
  agility: { boosts: { spe: 2 }, boostTarget: 'self' },
  amnesia: { boosts: { spd: 2 }, boostTarget: 'self' },
  growth: { boosts: { spa: 1 }, boostTarget: 'self' },
  meditate: { boosts: { atk: 1 }, boostTarget: 'self' },
  sharpen: { boosts: { atk: 1 }, boostTarget: 'self' },
  harden: { boosts: { def: 1 }, boostTarget: 'self' },
  withdraw: { boosts: { def: 1 }, boostTarget: 'self' },
  defensecurl: { boosts: { def: 1 }, boostTarget: 'self' },
  barrier: { boosts: { def: 2 }, boostTarget: 'self' },
  acidarmor: { boosts: { def: 2 }, boostTarget: 'self' },
  // ---- EVASION / ACCURACY moves (accuracy & evasion stages ARE modeled) ----
  // These affect the hit-chance formula in doMove's accuracy check.
  minimize: { boosts: { eva: 1 }, boostTarget: 'self' },     // +1 evasion
  doubleteam: { boosts: { eva: 1 }, boostTarget: 'self' },   // +1 evasion
  focusenergy: { boosts: {}, boostTarget: 'self' },          // crit-rate boost (still not modeled)

  // ---- guaranteed self stat DROPS from a "trade-off" status move ----------
  // (none currently in-pool beyond Curse's non-Ghost branch, handled specially)

  // ---- guaranteed TARGET stat drops -----------------------------------------
  growl: { boosts: { atk: -1 }, boostTarget: 'target' },
  leer: { boosts: { def: -1 }, boostTarget: 'target' },
  tailwhip: { boosts: { def: -1 }, boostTarget: 'target' },
  screech: { boosts: { def: -2 }, boostTarget: 'target' },
  charm: { boosts: { atk: -2 }, boostTarget: 'target' }, // was missing entirely — found while fixing #6's Fairy-type retag; Charm did nothing on use before this
  sandattack: { boosts: { acc: -1 }, boostTarget: 'target' }, // -1 target accuracy
  smokescreen: { boosts: { acc: -1 }, boostTarget: 'target' }, // -1 target accuracy
  flash: { boosts: { acc: -1 }, boostTarget: 'target' },       // -1 target accuracy
  kinesis: { boosts: { acc: -1 }, boostTarget: 'target' },     // -1 target accuracy
  stringshot: { boosts: { spe: -1 }, boostTarget: 'target' },
  scaryface: { boosts: { spe: -2 }, boostTarget: 'target' },
  cottonspore: { boosts: { spe: -2 }, boostTarget: 'target' },

  // ---- secondary effects on damaging moves (chance checked after a hit) ---
  bodyslam: { secondary: { chance: 30, status: 'par' } },
  stomp: { secondary: { chance: 30, flinch: true } },
  rollingkick: { secondary: { chance: 30, flinch: true } },
  headbutt: { secondary: { chance: 30, flinch: true } },
  bite: { secondary: { chance: 30, flinch: true } },
  lick: { secondary: { chance: 30, status: 'par' } },
  hyperfang: { secondary: { chance: 10, flinch: true } },
  icepunch: { secondary: { chance: 10, status: 'frz' } },
  firepunch: { secondary: { chance: 10, status: 'brn' } },
  thunderpunch: { secondary: { chance: 10, status: 'par' } },
  ember: { secondary: { chance: 10, status: 'brn' } },
  flamethrower: { secondary: { chance: 10, status: 'brn' } },
  fireblast: { secondary: { chance: 10, status: 'brn' } },
  // firespin: trapping not modeled — plain damage, no table entry needed.
  flamewheel: { secondary: { chance: 10, status: 'brn' } },
  sacredfire: { secondary: { chance: 50, status: 'brn' } },
  thundershock: { secondary: { chance: 10, status: 'par' } },
  thunderbolt: { secondary: { chance: 10, status: 'par' } },
  thunder: { secondary: { chance: 10, status: 'par' } },
  spark: { secondary: { chance: 30, status: 'par' } },
  zapcannon: { secondary: { chance: 100, status: 'par' } },
  icebeam: { secondary: { chance: 10, status: 'frz' } },
  blizzard: { secondary: { chance: 10, status: 'frz' } },
  powdersnow: { secondary: { chance: 10, status: 'frz' } },
  psybeam: { secondary: { chance: 10, confuse: true } },
  confusion: { secondary: { chance: 10, confuse: true } },
  dizzypunch: { secondary: { chance: 20, confuse: true } },
  acid: { secondary: { chance: 10, boosts: { def: -1 } } },
  psychic: { secondary: { chance: 10, boosts: { spd: -1 } } },
  aurorabeam: { secondary: { chance: 10, boosts: { atk: -1 } } },
  // ---- Tier-1 batch (requested audit pass) ---------------------------------
  dynamicpunch: { secondary: { chance: 100, confuse: true } }, // guaranteed confuse on hit — was a plain damage no-op
  mudslap: { secondary: { chance: 100, boosts: { acc: -1 } } }, // 100% target accuracy drop — now meaningful since acc stages are modeled (2.4.0)
  octazooka: { secondary: { chance: 40, boosts: { acc: -1 } } }, // 40% target accuracy drop — same as Mud-Slap
  boneclub: { secondary: { chance: 10, flinch: true } }, // 10% flinch — was missing entirely
  crunch: { secondary: { chance: 20, boosts: { def: -1 } } },
  shadowball: { secondary: { chance: 20, boosts: { spd: -1 } } },
  ancientpower: { secondary: { chance: 10, selfBoosts: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 } } },
  triattack: { secondary: { chance: 20, status: ['par', 'brn', 'frz'] } }, // #6 — was simplified to always-paralysis; now picks one of the three at random like the real move
  sludge: { secondary: { chance: 30, status: 'psn' } },
  sludgebomb: { secondary: { chance: 30, status: 'psn' } },
  poisonsting: { secondary: { chance: 20, status: 'psn' } },
  smog: { secondary: { chance: 40, status: 'psn' } },
  rocksmash: { secondary: { chance: 50, boosts: { def: -1 } } },
  rockslide: { secondary: { chance: 30, flinch: true } },
  irontail: { secondary: { chance: 30, boosts: { def: -1 } } },
  // mudslap: accuracy-drop not modeled — plain damage, no table entry needed.
  constrict: { secondary: { chance: 10, boosts: { spe: -1 } } },
  bubble: { secondary: { chance: 10, boosts: { spe: -1 } } },
  bubblebeam: { secondary: { chance: 10, boosts: { spe: -1 } } },
  icywind: { boosts: { spe: -1 }, boostTarget: 'target' }, // 100% speed drop (a damaging move that ALWAYS lowers the target's Speed) — affects turn order for the rest of the battle
  dragonbreath: { secondary: { chance: 30, status: 'par' } },
  metalclaw: { secondary: { chance: 10, boosts: { atk: 1 }, selfBoosts: { atk: 1 } } },
  steelwing: { secondary: { chance: 10, boosts: { def: 1 }, selfBoosts: { def: 1 } } },
};

// ---- tiny seeded PRNG (mulberry32) — deterministic given a seed -------------
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const chance = (rng, p) => rng() < p;
const randint = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// ---- stats ------------------------------------------------------------------
// Base -> real at level 100, DV 0, no stat exp (gen 1/2). HP gets +110, rest +5.
export function toRealStats(base, gen) {
  const r = { hp: 2 * base.hp + 110, atk: 2 * base.atk + 5, def: 2 * base.def + 5, spe: 2 * base.spe + 5 };
  if (gen === 1) r.spc = 2 * base.spc + 5;
  else { r.spa = 2 * base.spa + 5; r.spd = 2 * base.spd + 5; }
  return r;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function stageMul(stage) {
  stage = clamp(stage, -6, 6);
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

// Accuracy / evasion stages use a DIFFERENT table from the stat stages above.
// Per Bulbapedia (gen 2): the multiplier is (3 + stage)/3 for a positive stage
// and 3/(3 - stage) for a negative one — i.e. 3/3 = 1.0 at stage 0, up to
// 9/3 = 3.0 at +6 and down to 3/9 ≈ 0.33 at -6. The final hit chance is:
//   move.acc/100 × accStageMul(attacker.acc) × accStageMul(-defender.eva)
// (the target's evasion enters as the negative of its stage, so +evasion makes
// the attacker LESS likely to hit).
function accStageMul(stage) {
  stage = clamp(stage, -6, 6);
  return stage >= 0 ? (3 + stage) / 3 : 3 / (3 - stage);
}

export function moveId(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Real gen 1/2 multi-hit distribution: 2 and 3 hits are equally likely and
// together make up 75%; 4 and 5 hits share the remaining 25% equally.
function rollHitCount(rng) {
  const r = rng();
  if (r < 3 / 8) return 2;
  if (r < 6 / 8) return 3;
  if (r < 7 / 8) return 4;
  return 5;
}

// Flail / Reversal: power rises sharply as the user's HP falls.
function hpBasedBp(user) {
  const pct = user.hp / user.maxhp;
  if (pct >= 0.6875) return 20;
  if (pct >= 0.3542) return 40;
  if (pct >= 0.2083) return 80;
  if (pct >= 0.1042) return 100;
  if (pct >= 0.0417) return 150;
  return 200;
}

// ---- combatant construction -------------------------------------------------
function makeCombatant(spec, gen, moveData) {
  const types = (spec.types || []).filter(Boolean);
  const boosts = { atk: 0, def: 0, spe: 0, acc: 0, eva: 0 };
  if (gen === 1) boosts.spc = 0; else { boosts.spa = 0; boosts.spd = 0; }
  return {
    name: spec.name,
    types,
    stats: spec.stats,            // already real stats
    maxhp: spec.stats.hp,
    hp: spec.stats.hp,
    boosts,
    status: null,                 // 'par'|'brn'|'psn'|'tox'|'slp'|'frz'
    toxCounter: 0,
    sleepTurns: 0,
    confuseTurns: 0,
    flinch: false,
    cursed: false,                // #6e — Curse (Ghost-type user variant)
    seededBy: null,                // #6 — Leech Seed: reference to whoever planted it
    chargingMove: null,            // #6b — Fly/Dig/Solarbeam/Razor Wind mid-charge
    invulnThisTurn: false,         // #6b — Fly/Dig semi-invulnerability
    mustRecharge: false,           // #6a — Hyper Beam
    reflectTurns: 0,               // Reflect: halves incoming PHYSICAL damage while > 0
    lightScreenTurns: 0,           // Light Screen: halves incoming SPECIAL damage while > 0
    enduring: false,                // Tier-1: Endure — survive this turn's hit at 1 HP
    protecting: false,              // Tier-1: Protect/Detect — block this turn's incoming hit
    safeguardTurns: 0,              // Tier-2: Safeguard — status immunity while > 0 (5 turns)
    nightmared: false,              // Tier-2: Nightmare — chips 1/4 max HP/turn while asleep
    lockedOn: false,                // Tier-2: Lock-On/Mind Reader — next move can't miss
    rampMoveId: null,               // Tier-2: Fury Cutter/Rollout — id of the current ramping move
    rampStreak: 0,                  // Tier-2: consecutive successful hits with rampMoveId (0 = first)
    rolloutMove: null,              // Tier-2: Rollout — move object the mon is locked into repeating
    rolloutTurns: 0,                // Tier-2: Rollout — forced repeats remaining
    rampageMove: null,              // Tier-3: Outrage/Thrash/Petal Dance — move the mon is locked into
    rampageTurns: 0,                // Tier-3: rampage turns remaining (2–3), then self-confusion
    trappedTurns: 0,                // Simplified-moves: Wrap/Bind/Fire Spin/Clamp/Whirlpool — 1/16 chip while > 0
    mistTurns: 0,                   // Simplified-moves: Mist — blocks opponent-induced stat drops while > 0
    subHp: 0,                       // Simplified-moves: Substitute — absorbs damage/status while > 0
    moves: (spec.moves || []).map((nm) => {
      const hp = HP_TYPE_RE.exec(nm);
      if (hp) {
        const type = hp[1].charAt(0).toUpperCase() + hp[1].slice(1).toLowerCase();
        const base = moveData['hiddenpower'] || { bp: 70, acc: 100, pp: 15, prio: 0 };
        return { name: nm, id: 'hiddenpower', ...base, type, cat: gen12Category(type) };
      }
      const id = moveId(nm);
      const data = moveData[id] || FALLBACK_MOVE;
      const fx = MOVE_EFFECTS[id] || {};
      return { name: nm, id, ...data, ...fx };
    }),
  };
}

// gen 1 collapses spa/spd boost keys onto the single special stage
function boostKey(stat, gen) {
  if (gen === 1 && (stat === 'spa' || stat === 'spd' || stat === 'spc')) return 'spc';
  return stat;
}
function specialOff(gen) { return gen === 1 ? 'spc' : 'spa'; }
function specialDef(gen) { return gen === 1 ? 'spc' : 'spd'; }

function effectiveSpeed(c) {
  let s = c.stats.spe * stageMul(c.boosts.spe);
  if (c.status === 'par') s *= PARA_SPEED;
  return s;
}

// ---- damage -----------------------------------------------------------------
function typeEffectiveness(moveType, defTypes, chart) {
  let m = 1;
  for (const t of defTypes) {
    const row = chart[moveType];
    if (row && row[t] != null) m *= row[t];
  }
  return m;
}

function calcDamage(atkr, defr, move, rng, gen, chart, log, extraMul = 1, field = null) {
  const physical = move.cat === 'Physical';
  let A, D;
  if (physical) {
    A = atkr.stats.atk * stageMul(atkr.boosts.atk);
    D = defr.stats.def * stageMul(defr.boosts.def);
    if (atkr.status === 'brn') A *= 0.5; // burn halves physical attack
  } else {
    A = atkr.stats[specialOff(gen)] * stageMul(atkr.boosts[boostKey('spa', gen)]);
    D = defr.stats[specialDef(gen)] * stageMul(defr.boosts[boostKey('spd', gen)]);
  }

  const eff = typeEffectiveness(move.type, defr.types, chart);
  if (eff === 0) { log.push({ t: 'immune', target: defr.name, move: move.name }); return 0; }

  if (move.ohko) { // one-hit KO: if it lands, it's lethal
    log.push({ t: 'ohko', target: defr.name, move: move.name });
    return defr.hp;
  }

  const crit = chance(rng, move.highCrit ? CRIT_RATE_HIGH : CRIT_RATE);
  if (crit) { A = atkr.stats[physical ? 'atk' : specialOff(gen)]; } // crit ignores boosts (facsimile)

  const bp = move.hpBasedPower ? hpBasedBp(atkr) : move.bp;
  let dmg = Math.floor(Math.floor((Math.floor((2 * LEVEL) / 5 + 2) * bp * A) / Math.max(1, D)) / 50) + 2;
  const stab = atkr.types.includes(move.type) ? STAB : 1;
  dmg = Math.floor(dmg * stab);
  dmg = Math.floor(dmg * eff);
  if (crit) dmg = Math.floor(dmg * CRIT_MULT);
  // Reflect halves physical damage; Light Screen halves special damage. A
  // critical hit ignores screens (authentic Gen 2). Applied here so it
  // composes with STAB/effectiveness like the real damage formula.
  if (!crit) {
    if (physical && defr.reflectTurns > 0) dmg = Math.max(1, Math.floor(dmg / 2));
    else if (!physical && defr.lightScreenTurns > 0) dmg = Math.max(1, Math.floor(dmg / 2));
  }
  // Tier-2: Fly/Dig type-exception moves (Gust/Twister vs Fly, Earthquake/
  // Magnitude vs Dig) deal double damage to the airborne/underground target.
  if (extraMul !== 1) dmg = Math.floor(dmg * extraMul);
  // Weather (Simplified-moves): Rain boosts Water / weakens Fire; Sun boosts
  // Fire / weakens Water (gen-2 ×1.5 / ×0.5).
  if (field && field.weather) {
    if (field.weather === 'rain') {
      if (move.type === 'Water') dmg = Math.floor(dmg * 1.5);
      else if (move.type === 'Fire') dmg = Math.floor(dmg * 0.5);
    } else if (field.weather === 'sun') {
      if (move.type === 'Fire') dmg = Math.floor(dmg * 1.5);
      else if (move.type === 'Water') dmg = Math.floor(dmg * 0.5);
    }
  }
  const roll = (217 + Math.floor(rng() * 39)) / 255; // gen 1/2 random spread ~0.85–1.0
  dmg = Math.max(1, Math.floor(dmg * roll));

  log.push({
    t: 'damage', source: atkr.name, target: defr.name, move: move.name,
    amount: dmg, crit, eff,
  });
  return dmg;
}

// Fixed/variable damage that skips the normal stat formula entirely, but
// still respects type immunity (#6).
function calcFixedDamage(atkr, defr, move, rng, chart, log) {
  const eff = typeEffectiveness(move.type, defr.types, chart);
  if (eff === 0) { log.push({ t: 'immune', target: defr.name, move: move.name }); return 0; }
  let dmg;
  if (move.fixedDamage === 'level') dmg = LEVEL;
  else if (move.fixedDamage === 'halfhp') dmg = Math.max(1, Math.floor(defr.hp / 2));
  else if (move.fixedDamage === 'psywave') dmg = randint(rng, Math.floor(LEVEL * 0.5), Math.ceil(LEVEL * 1.5) - 1);
  else dmg = move.fixedDamage;
  dmg = Math.max(1, Math.min(dmg, defr.hp));
  log.push({ t: 'damage', source: atkr.name, target: defr.name, move: move.name, amount: dmg, crit: false, eff });
  return dmg;
}

// ---- applying a move --------------------------------------------------------
function applyBoosts(target, boosts, gen, log, who) {
  for (const [stat, delta] of Object.entries(boosts)) {
    const k = boostKey(stat, gen);
    if (target.boosts[k] == null) continue;
    const before = target.boosts[k];
    target.boosts[k] = clamp(before + delta, -6, 6);
    if (target.boosts[k] !== before) log.push({ t: 'boost', target: target.name, stat: k, delta });
  }
}

function tryStatus(target, status, rng, log) {
  if (target.status) return false;            // one major status at a time
  if (target.safeguardTurns > 0) { log.push({ t: 'safeguard-block', target: target.name }); return false; } // Tier-2: Safeguard blocks all major status
  // simple type-based immunities for the common cases
  if ((status === 'brn') && target.types.includes('Fire')) return false;
  if ((status === 'frz') && target.types.includes('Ice')) return false;
  if ((status === 'psn' || status === 'tox') && (target.types.includes('Poison') || target.types.includes('Steel'))) return false;
  target.status = status;
  if (status === 'slp') target.sleepTurns = randint(rng, 1, 7); // #6 corrected from an earlier 1–3 guess: gen 1/2 sleep is 1–7 turns, not the modern 1–3
  if (status === 'tox') target.toxCounter = 1;
  log.push({ t: 'status', target: target.name, status });
  return true;
}

// Applies incoming damage to the defender. Substitute (Simplified-moves)
// intercepts first: while a sub is up, damage hits the sub instead of the mon,
// and gen-2 excess damage does NOT carry over when the sub breaks. Otherwise
// honors Endure (Tier-1): if the defender used Endure THIS turn and this hit
// would otherwise faint it, it survives with 1 HP. Self-inflicted recoil/crash/
// curse-cost do NOT go through this (they hit the mon, never the sub).
function applyDamageToDefender(defender, amount, log) {
  if (defender.subHp > 0) {
    defender.subHp -= amount;
    if (defender.subHp <= 0) { defender.subHp = 0; log.push({ t: 'sub-break', target: defender.name }); }
    else log.push({ t: 'sub-damage', target: defender.name, amount });
    return;
  }
  const newHp = defender.hp - amount;
  if (defender.enduring && defender.hp > 0 && newHp <= 0) {
    defender.hp = 1;
    log.push({ t: 'endure', target: defender.name });
  } else {
    defender.hp = Math.max(0, newHp);
  }
}

// Tier-2: reset a combatant's ramping-move streak AND any Rollout lock. Called
// whenever a ramp move fails to connect (miss / blocked / immune) or the mon
// uses a different move — the "consecutive successful use" chain is broken.
function breakRamp(c) {
  c.rampMoveId = null;
  c.rampStreak = 0;
  c.rolloutMove = null;
  c.rolloutTurns = 0;
}

// Tier-3: advance a rampage (Outrage/Thrash/Petal Dance) after the user has
// acted this turn. Called from the turn loop right after doMove, so it runs on
// every path the move actually took (hit, miss, blocked, immune). When the
// 2–3 turn count is exhausted, the lock releases and the user is confused from
// fatigue (self-inflicted — ignores the user's own Safeguard, disclosed).
function tickRampage(c, rng, log) {
  if (!c.rampageMove) return;
  c.rampageTurns--;
  if (c.rampageTurns <= 0) {
    c.rampageMove = null;
    if (c.hp > 0) {
      if (c.confuseTurns === 0) c.confuseTurns = randint(rng, 2, 4);
      log.push({ t: 'rampage-end', target: c.name });
    }
  }
}

// Apply boosts to a FOE (opponent-induced). Mist (Simplified-moves) blocks any
// stat-lowering component while active; positive components (rare on foe-target
// moves) still apply. Self-targeted boosts never go through here.
function applyFoeBoosts(target, boosts, gen, log) {
  if (target.mistTurns > 0) {
    const kept = {};
    let blockedAny = false;
    for (const [k, v] of Object.entries(boosts)) {
      if (v < 0) blockedAny = true; else kept[k] = v;
    }
    if (blockedAny) log.push({ t: 'mist-block', target: target.name });
    if (Object.keys(kept).length) applyBoosts(target, kept, gen, log);
    return;
  }
  applyBoosts(target, boosts, gen, log);
}

function doMove(attacker, defender, move, rng, gen, chart, log, releasingCharge, field) {
  // ---- Tier-3 rampage start: the first time a rampage move is used, lock the
  // user in for 2–3 turns. Set BEFORE any early return so a turn always counts
  // (a missed/blocked/immune rampage move still burns a locked turn). The
  // actual decrement + fatigue confusion happen in tickRampage() after doMove.
  if (move.rampage && !attacker.rampageMove) {
    attacker.rampageMove = move;
    attacker.rampageTurns = randint(rng, 2, 3);
    log.push({ t: 'rampage-start', source: attacker.name, move: move.name });
  }
  // ---- semi-invulnerable target (Fly/Dig charge turn) ----------------------
  // Normally nothing can hit a mon mid-Fly/Dig. Exceptions (Tier-2): the
  // attacker is Locked-On (Lock-On/Mind Reader — hits through anything), or the
  // move is one that reaches the specific hiding spot (Gust/Twister hit Fly,
  // Earthquake/Magnitude hit Dig) — those also deal DOUBLE damage. `chId` is
  // whatever the defender is charging; it's still set this turn because
  // chargingMove isn't cleared until next turn's chooseMoveForTurn.
  let invulnDoubles = false;
  if (defender.invulnThisTurn) {
    const chId = defender.chargingMove && defender.chargingMove.id;
    const exception = (move.hitsFly && chId === 'fly') || (move.hitsDig && chId === 'dig');
    if (attacker.lockedOn) {
      // Lock-On lets it through, but with no 2× bonus (that's only for the
      // type-specific exceptions). Accuracy check below will also auto-hit.
    } else if (exception) {
      invulnDoubles = true;
    } else {
      log.push({ t: 'miss', source: attacker.name, move: move.name, reason: 'invuln' });
      breakRamp(attacker);
      return;
    }
  }

  // ---- two-turn charge: turn 1 (not releasing) — just charge, no damage ----
  // Weather (Simplified-moves): Solar Beam skips the charge turn in harsh sun,
  // firing immediately (falls straight through to resolve this turn).
  const solarInSun = move.id === 'solarbeam' && field && field.weather === 'sun';
  if (move.twoTurn && !releasingCharge && !solarInSun) {
    attacker.chargingMove = move;
    if (move.semiInvuln) attacker.invulnThisTurn = true;
    log.push({ t: 'charge', source: attacker.name, move: move.name });
    return;
  }
  // if releasingCharge is true (or Solar Beam in sun), fall through — the move
  // executes for real now.

  // ---- Protect / Detect (Tier-1): block any move that would actually affect
  // the defender. Self-only special cases (Rest/Belly Drum/Reflect/Light
  // Screen/Endure) and generic self-only boosts (Swords Dance, Agility, ...)
  // don't target the defender at all, so Protect has nothing to block there —
  // everything else (damage, guaranteed/secondary status, Curse, Leech Seed,
  // Pain Split, Haze) is blocked outright. Simplification, disclosed: Curse's
  // non-Ghost branch is a pure self-buff that doesn't need blocking, but for
  // simplicity it's blocked like its Ghost branch rather than special-cased
  // further — a harmless over-block in a rare edge case.
  if (defender.protecting) {
    const selfOnlySpecial = ['rest', 'bellydrum', 'reflect', 'lightscreen', 'endure'].includes(move.special);
    const selfOnlyBoost = move.boostTarget === 'self' && !(move.bp > 0) && !move.ohko && move.fixedDamage == null;
    if (!selfOnlySpecial && !selfOnlyBoost) {
      log.push({ t: 'protect-block', source: attacker.name, target: defender.name, move: move.name });
      breakRamp(attacker);
      return;
    }
  }

  // ---- special-cased moves that don't fit the generic pipeline (#6) --------
  if (move.special === 'endure') {
    attacker.enduring = true;
    log.push({ t: 'endure-ready', target: attacker.name });
    return;
  }
  if (move.special === 'protect') {
    attacker.protecting = true;
    log.push({ t: 'protect-ready', target: attacker.name });
    return;
  }
  if (move.special === 'haze') {
    for (const k of Object.keys(attacker.boosts)) attacker.boosts[k] = 0;
    for (const k of Object.keys(defender.boosts)) defender.boosts[k] = 0;
    log.push({ t: 'haze' });
    return;
  }
  if (move.special === 'safeguard') {
    attacker.safeguardTurns = 5;
    log.push({ t: 'safeguard', target: attacker.name });
    return;
  }
  if (move.special === 'lockon') {
    attacker.lockedOn = true;
    log.push({ t: 'lockon', source: attacker.name, target: defender.name });
    return;
  }
  if (move.special === 'mist') {
    attacker.mistTurns = 5; // Simplified-moves: blocks opponent-induced stat drops
    log.push({ t: 'mist', target: attacker.name });
    return;
  }
  if (move.special === 'substitute') {
    // Costs 1/4 max HP; fails if a sub is already up or HP is too low to pay.
    const cost = Math.floor(attacker.maxhp / 4);
    if (attacker.subHp > 0 || attacker.hp <= cost) { log.push({ t: 'fail', target: attacker.name, move: move.name }); return; }
    attacker.hp -= cost;
    attacker.subHp = cost + 1; // gen 1/2 sub has 1/4 max HP + 1
    log.push({ t: 'sub', target: attacker.name, cost });
    return;
  }
  if (move.special === 'weather') {
    // Set the field weather for 5 turns. Re-using the same weather refreshes it.
    field.weather = move.weatherKind;
    field.weatherTurns = 5;
    log.push({ t: 'weather-start', weather: move.weatherKind });
    return;
  }
  if (move.special === 'nightmare') {
    // Fails unless the target is asleep; sets a flag that chips 1/4 max HP each
    // end-of-turn until they wake (the wake path clears it). Accuracy is 100
    // and never-miss in practice here; no accuracy roll needed for a status
    // move with acc:100 vs a sleeping target.
    if (defender.status !== 'slp') { log.push({ t: 'fail', target: defender.name, move: move.name }); return; }
    if (!defender.nightmared) { defender.nightmared = true; log.push({ t: 'nightmare', target: defender.name }); }
    return;
  }
  if (move.special === 'curse') {
    if (attacker.types.includes('Ghost')) {
      const cost = Math.max(1, Math.floor(attacker.maxhp / 2));
      attacker.hp = Math.max(0, attacker.hp - cost);
      log.push({ t: 'curse-cost', target: attacker.name, amount: cost });
      if (!defender.cursed) { defender.cursed = true; log.push({ t: 'curse', target: defender.name }); }
    } else {
      applyBoosts(attacker, { atk: 1, def: 1, spe: -1 }, gen, log);
    }
    return;
  }
  if (move.special === 'bellydrum') {
    const cost = Math.floor(attacker.maxhp / 2);
    if (attacker.hp <= cost) { log.push({ t: 'fail', target: attacker.name, move: move.name }); return; }
    attacker.hp -= cost;
    attacker.boosts[boostKey('atk', gen)] = 6;
    log.push({ t: 'bellydrum', target: attacker.name, amount: cost });
    return;
  }
  if (move.special === 'rest') {
    attacker.hp = attacker.maxhp;
    attacker.status = 'slp';
    attacker.sleepTurns = 2; // Rest always sleeps for exactly 2 turns
    attacker.toxCounter = 0;
    log.push({ t: 'rest', target: attacker.name });
    return;
  }
  if (move.special === 'painsplit') {
    const avg = Math.floor((attacker.hp + defender.hp) / 2);
    attacker.hp = Math.min(attacker.maxhp, avg);
    defender.hp = Math.min(defender.maxhp, avg);
    log.push({ t: 'painsplit', source: attacker.name, target: defender.name });
    return;
  }
  if (move.special === 'leechseed') {
    if (defender.subHp > 0 || defender.types.includes('Grass') || defender.seededBy) { log.push({ t: 'fail', target: defender.name, move: move.name }); return; }
    defender.seededBy = attacker;
    log.push({ t: 'leechseed', target: defender.name });
    return;
  }
  if (move.special === 'reflect') {
    // Guards the USER's side, halving incoming physical damage for 5 turns.
    // (No stacking/failure-on-reactivation modeled — just refreshes to 5.)
    attacker.reflectTurns = 5;
    log.push({ t: 'reflect', target: attacker.name });
    return;
  }
  if (move.special === 'lightscreen') {
    attacker.lightScreenTurns = 5;
    log.push({ t: 'lightscreen', target: attacker.name });
    return;
  }

  // ---- accuracy (now factors in accuracy/evasion STAGES) ---------------
  // Lock-On / Mind Reader (Tier-2): if the attacker locked on last turn, this
  // move can't miss — skip the roll and consume the one-shot flag. (It also
  // already bypassed semi-invuln above.)
  const noMiss = attacker.lockedOn;
  if (attacker.lockedOn) { attacker.lockedOn = false; log.push({ t: 'lockon-hit', source: attacker.name }); }
  // Weather (Simplified-moves): Thunder never misses in rain, and its accuracy
  // drops to 50% in harsh sun. Applied as an accuracy multiplier / no-miss.
  const thunderRainNoMiss = move.id === 'thunder' && field && field.weather === 'rain';
  if (!noMiss && !thunderRainNoMiss && move.acc !== true && move.acc != null && !move.ohko) {
    let acc = move.acc;
    if (move.id === 'thunder' && field && field.weather === 'sun') acc = 50;
    const hitChance = (acc / 100) * accStageMul(attacker.boosts.acc) * accStageMul(-defender.boosts.eva);
    if (!chance(rng, Math.min(1, hitChance))) {
      log.push({ t: 'miss', source: attacker.name, move: move.name });
      breakRamp(attacker); // a missed ramp move (Fury Cutter/Rollout) resets its streak/lock
      if (move.crashOnMiss) { // #6 — Jump Kick / High Jump Kick "crash" on a miss
        const crash = Math.max(1, Math.floor(attacker.maxhp * CRASH_FRACTION));
        attacker.hp = Math.max(0, attacker.hp - crash);
        log.push({ t: 'crash', target: attacker.name, amount: crash });
      }
      return;
    }
  }
  log.push({ t: 'use', source: attacker.name, move: move.name });

  // Substitute (Simplified-moves): capture whether the DEFENDER had a sub up at
  // the moment this move connected. Damage is redirected to the sub in
  // applyDamageToDefender; every defender-targeting side-effect below (status,
  // confusion, flinch, stat drops, Leech Seed, trap) is blocked while the sub
  // was up — even if this move breaks the sub, its effects still don't reach
  // the mon this turn (authentic gen-2). Self-effects are unaffected.
  const hadSub = defender.subHp > 0;

  // Dream Eater — fails outright unless the target is asleep
  if (move.requiresAsleep && defender.status !== 'slp') {
    log.push({ t: 'fail', target: defender.name, move: move.name });
    return;
  }
  // Snore (Tier-3) — fails unless the USER is asleep. (preMove only lets Snore
  // act while asleep, so this guards the awake case: a mon that picks Snore
  // while awake gets here and fails, matching the real move.)
  if (move.requiresSelfAsleep && attacker.status !== 'slp') {
    log.push({ t: 'fail', target: attacker.name, move: move.name });
    return;
  }

  // Tier-2 ramp setup (Fury Cutter / Rollout): power DOUBLES per consecutive
  // successful hit with the same move. Base power stays data-driven; only the
  // ramp mechanic lives here. Using any different move breaks the chain.
  let dmgMove = move;
  const extraMul = invulnDoubles ? 2 : 1; // Fly/Dig type-exception moves hit 2×
  if (move.ramp) {
    if (attacker.rampMoveId !== move.id) { attacker.rampMoveId = move.id; attacker.rampStreak = 0; }
    const doublings = Math.min(attacker.rampStreak, RAMP_MAX_DOUBLINGS);
    if (doublings > 0) {
      dmgMove = { ...move, bp: move.bp * (2 ** doublings) };
      log.push({ t: 'ramp', source: attacker.name, move: move.name, bp: dmgMove.bp });
    }
  } else if (attacker.rampMoveId) {
    breakRamp(attacker); // used a different move → streak (and any Rollout lock) ends
  }

  let dealt = 0;
  if (move.fixedDamage != null) {
    dealt = calcFixedDamage(attacker, defender, move, rng, chart, log);
    applyDamageToDefender(defender, dealt, log);
  } else if (move.multiHit) {
    const [lo, hi] = move.multiHit;
    const hits = lo === hi ? lo : rollHitCount(rng);
    let total = 0, actualHits = 0;
    for (let i = 0; i < hits; i++) {
      if (defender.hp <= 0) break;
      const hitMove = move.rampBp ? { ...move, bp: move.rampBp[Math.min(i, move.rampBp.length - 1)] } : move;
      const d = calcDamage(attacker, defender, hitMove, rng, gen, chart, log, extraMul, field);
      applyDamageToDefender(defender, d, log);
      total += d; actualHits++;
    }
    dealt = total;
    log.push({ t: 'multihit', target: defender.name, hits: actualHits });
  } else if (move.magnitudeRoll) {
    const roll = rollMagnitude(rng);
    log.push({ t: 'magnitude', target: defender.name, level: roll.level });
    dealt = calcDamage(attacker, defender, { ...move, bp: roll.bp }, rng, gen, chart, log, extraMul, field);
    applyDamageToDefender(defender, dealt, log);
  } else if (move.cat !== 'Status' && (move.bp > 0 || move.ohko)) {
    dealt = calcDamage(attacker, defender, dmgMove, rng, gen, chart, log, extraMul, field);
    applyDamageToDefender(defender, dealt, log);
  }

  // Tier-2 ramp bookkeeping AFTER the hit is resolved.
  if (move.ramp) {
    if (dealt > 0) {
      attacker.rampStreak = attacker.rampStreak + 1;
      if (move.rolloutLock) {
        if (!attacker.rolloutMove) attacker.rolloutMove = move;            // lock begins on the first hit
        if (attacker.rampStreak > RAMP_MAX_DOUBLINGS) breakRamp(attacker); // 5 hits done → release; can start over
      }
    } else {
      breakRamp(attacker); // immune / 0-damage hit breaks the chain
    }
  }

  // self heal (Recover / Softboiled / ...)
  if (move.heal && move.cat === 'Status') {
    let [num, den] = move.heal;
    // Weather (Simplified-moves): Synthesis/Morning Sun/Moonlight heal 2/3 in
    // sun, 1/4 in rain or sandstorm, and the normal 1/2 in clear weather.
    if (move.weatherHeal && field && field.weather) {
      if (field.weather === 'sun') { num = 2; den = 3; }
      else { num = 1; den = 4; } // rain or sand
    }
    const heal = Math.floor(attacker.maxhp * num / den);
    const before = attacker.hp;
    attacker.hp = Math.min(attacker.maxhp, attacker.hp + heal);
    if (attacker.hp !== before) log.push({ t: 'heal', target: attacker.name, amount: attacker.hp - before });
  }
  // drain (Absorb / Mega Drain / Giga Drain / Leech Life / Dream Eater)
  if (move.drain && dealt > 0) {
    const heal = Math.max(1, Math.floor(dealt * move.drain[0] / move.drain[1]));
    const before = attacker.hp;
    attacker.hp = Math.min(attacker.maxhp, attacker.hp + heal);
    if (attacker.hp !== before) log.push({ t: 'drain', target: attacker.name, amount: attacker.hp - before });
  }
  // recoil (Double-Edge / Take Down / Submission)
  if (move.recoil && dealt > 0) {
    const r = Math.max(1, Math.floor(dealt * move.recoil[0] / move.recoil[1]));
    attacker.hp = Math.max(0, attacker.hp - r);
    log.push({ t: 'recoil', target: attacker.name, amount: r });
  }
  // trapping (Wrap/Bind/Fire Spin/Clamp/Whirlpool): a connecting hit binds the
  // target for 2–5 turns of 1/16 chip. Only sets if not already trapped, so a
  // re-hit mid-trap doesn't stack; chip + countdown run in endOfTurn.
  if (move.trap && dealt > 0 && !hadSub && defender.hp > 0 && defender.trappedTurns === 0) {
    defender.trappedTurns = randint(rng, 2, 5);
    log.push({ t: 'trap', source: attacker.name, target: defender.name, move: move.name, turns: defender.trappedTurns });
  }

  // guaranteed status / confuse / boosts (status moves). Substitute blocks all
  // defender-targeting effects (hadSub) — status/confusion/stat drops can't
  // reach the mon behind an (even freshly-broken) sub.
  if (move.status && defender.hp > 0 && !hadSub) tryStatus(defender, move.status, rng, log);
  if (move.confuse && defender.hp > 0 && !hadSub && defender.confuseTurns === 0) {
    if (defender.safeguardTurns > 0) { log.push({ t: 'safeguard-block', target: defender.name }); }
    else { defender.confuseTurns = randint(rng, 2, 4); log.push({ t: 'confuse', target: defender.name }); }
  }
  if (move.boosts && Object.keys(move.boosts).length && defender.hp > 0) {
    // A pure Status move always applies its boost. A DAMAGING move that also
    // carries a guaranteed boost (e.g. Icy Wind's 100% Speed drop) should only
    // apply it when the hit actually connected — a type-immune no-op must not
    // still drop the target's stat.
    const damaging = move.cat !== 'Status' && (move.bp > 0 || move.ohko);
    if (!damaging || dealt > 0) {
      if (move.boostTarget === 'self') { if (attacker.hp > 0) applyBoosts(attacker, move.boosts, gen, log); }
      else if (defender.hp > 0 && !hadSub) applyFoeBoosts(defender, move.boosts, gen, log);
    }
  }

  // secondary effects (from damaging moves — chance checked AFTER a successful hit)
  if (move.secondary && defender.hp > 0 && dealt > 0) {
    if (chance(rng, move.secondary.chance / 100)) {
      // Defender-targeting secondaries are blocked while the target had a sub
      // (hadSub); the attacker's own self-boost secondary still procs.
      if (move.secondary.status && !hadSub) {
        // #6 — Tri Attack's status is an array (random pick); every other
        // move using this field still passes a plain string, unaffected.
        const st = Array.isArray(move.secondary.status)
          ? move.secondary.status[Math.floor(rng() * move.secondary.status.length)]
          : move.secondary.status;
        tryStatus(defender, st, rng, log);
      }
      if (move.secondary.flinch && !hadSub) defender.flinch = true;
      if (move.secondary.confuse && !hadSub && defender.confuseTurns === 0) {
        if (defender.safeguardTurns > 0) { log.push({ t: 'safeguard-block', target: defender.name }); }
        else { defender.confuseTurns = randint(rng, 2, 4); log.push({ t: 'confuse', target: defender.name }); }
      }
      if (move.secondary.boosts && !hadSub) applyFoeBoosts(defender, move.secondary.boosts, gen, log);
      if (move.secondary.selfBoosts) applyBoosts(attacker, move.secondary.selfBoosts, gen, log);
    }
  }

  // recharge (Hyper Beam) — required whenever used, UNLESS it just fainted the target
  if (move.recharge && defender.hp > 0) attacker.mustRecharge = true;
}

// Decide what a combatant does this turn, resolving recharge/charge state
// BEFORE a fresh random move would ever be picked (#6a/#6b).
function chooseMoveForTurn(c, rng) {
  if (c.mustRecharge) { c.mustRecharge = false; return { move: null, releasing: false }; }
  if (c.chargingMove) { const m = c.chargingMove; c.chargingMove = null; return { move: m, releasing: true }; }
  if (c.rolloutMove) { return { move: c.rolloutMove, releasing: false }; } // Tier-2: Rollout forces its own repeat until the lock releases
  if (c.rampageMove) { return { move: c.rampageMove, releasing: false }; } // Tier-3: Outrage/Thrash/Petal Dance forces itself for 2–3 turns
  return { move: pick(rng, c.moves), releasing: false };
}

// can this mon act this turn? handles slp/frz/par/flinch/confusion. `move` is
// the move it's about to use (needed so Snore can act while asleep).
function preMove(c, move, rng, log) {
  if (c.status === 'slp') {
    if (c.sleepTurns > 0) {
      // Still asleep this turn: sleep always ticks down by one. Snore (Tier-3)
      // is the one move usable WHILE asleep — it acts without ending the sleep
      // early, so the sleep-duration invariant (N turns = N ticks) is
      // preserved whether or not Snore is the chosen move.
      c.sleepTurns--;
      if (move && move.requiresSelfAsleep) {
        log.push({ t: 'asleep-acts', target: c.name, move: move.name });
        return true;
      }
      log.push({ t: 'asleep', target: c.name });
      return false;
    }
    // counter already 0 at the start of this turn → wake up now and act
    c.status = null;
    if (c.nightmared) { c.nightmared = false; log.push({ t: 'nightmare-end', target: c.name }); } // Tier-2: Nightmare ends on waking
    log.push({ t: 'wake', target: c.name });
  }
  if (c.status === 'frz') {
    if (chance(rng, FREEZE_THAW)) { c.status = null; log.push({ t: 'thaw', target: c.name }); }
    else { log.push({ t: 'frozen', target: c.name }); return false; }
  }
  if (c.flinch) { c.flinch = false; log.push({ t: 'flinch', target: c.name }); return false; }
  if (c.status === 'par' && chance(rng, PARA_FULL)) { log.push({ t: 'fullpara', target: c.name }); return false; }
  if (c.confuseTurns > 0) {
    c.confuseTurns--;
    if (c.confuseTurns === 0) log.push({ t: 'confuse-end', target: c.name });
    if (chance(rng, CONFUSE_SELF)) {
      // hit self: typeless physical, 40 bp, own atk vs own def
      const A = c.stats.atk * stageMul(c.boosts.atk);
      const D = c.stats.def * stageMul(c.boosts.def);
      let dmg = Math.floor(Math.floor((Math.floor((2 * LEVEL) / 5 + 2) * CONFUSE_BP * A) / Math.max(1, D)) / 50) + 2;
      dmg = Math.max(1, dmg);
      c.hp = Math.max(0, c.hp - dmg);
      log.push({ t: 'confused-hit', target: c.name, amount: dmg });
      return false;
    }
  }
  return true;
}

function endOfTurn(c, log, field) {
  if (c.hp <= 0) return;
  // Endure/Protect only guard the turn they were used — cleared here, BEFORE
  // residual chip damage below, so poison/burn/curse/Leech Seed can still
  // finish off an Endure-saved mon (Endure blocks the attack, not the chip).
  c.enduring = false;
  c.protecting = false;
  if (c.status === 'brn') { const d = Math.max(1, Math.floor(c.maxhp * BRN_FRACTION)); c.hp = Math.max(0, c.hp - d); log.push({ t: 'chip', target: c.name, cause: 'brn', amount: d }); }
  else if (c.status === 'psn') { const d = Math.max(1, Math.floor(c.maxhp * PSN_FRACTION)); c.hp = Math.max(0, c.hp - d); log.push({ t: 'chip', target: c.name, cause: 'psn', amount: d }); }
  else if (c.status === 'tox') { const d = Math.max(1, Math.floor(c.maxhp * TOX_FRACTION * c.toxCounter)); c.hp = Math.max(0, c.hp - d); log.push({ t: 'chip', target: c.name, cause: 'tox', amount: d }); c.toxCounter++; }
  if (c.hp > 0 && c.cursed) {
    const d = Math.max(1, Math.floor(c.maxhp * CURSE_CHIP_FRACTION));
    c.hp = Math.max(0, c.hp - d);
    log.push({ t: 'chip', target: c.name, cause: 'curse', amount: d });
  }
  if (c.hp > 0 && c.nightmared && c.status === 'slp') {
    const d = Math.max(1, Math.floor(c.maxhp * NIGHTMARE_FRACTION));
    c.hp = Math.max(0, c.hp - d);
    log.push({ t: 'chip', target: c.name, cause: 'nightmare', amount: d });
  }
  if (c.hp > 0 && c.trappedTurns > 0) {
    const d = Math.max(1, Math.floor(c.maxhp * TRAP_FRACTION));
    c.hp = Math.max(0, c.hp - d);
    c.trappedTurns--;
    log.push({ t: 'chip', target: c.name, cause: 'trap', amount: d });
    if (c.trappedTurns === 0) log.push({ t: 'trap-end', target: c.name });
  }
  if (c.hp > 0 && c.seededBy && c.seededBy.hp > 0) {
    const d = Math.max(1, Math.floor(c.maxhp * LEECH_SEED_FRACTION));
    c.hp = Math.max(0, c.hp - d);
    const before = c.seededBy.hp;
    c.seededBy.hp = Math.min(c.seededBy.maxhp, c.seededBy.hp + d);
    log.push({ t: 'chip', target: c.name, cause: 'leechseed', amount: d, healed: c.seededBy.hp - before });
  }
  // Reflect / Light Screen tick down and expire (5 turns each).
  if (c.reflectTurns > 0) { c.reflectTurns--; if (c.reflectTurns === 0) log.push({ t: 'reflect-end', target: c.name }); }
  if (c.lightScreenTurns > 0) { c.lightScreenTurns--; if (c.lightScreenTurns === 0) log.push({ t: 'lightscreen-end', target: c.name }); }
  if (c.safeguardTurns > 0) { c.safeguardTurns--; if (c.safeguardTurns === 0) log.push({ t: 'safeguard-end', target: c.name }); }
  if (c.mistTurns > 0) { c.mistTurns--; if (c.mistTurns === 0) log.push({ t: 'mist-end', target: c.name }); }
  // Weather (Simplified-moves): Sandstorm chips 1/16 max HP to anything not
  // Rock/Ground/Steel. (Gen-2 sandstorm does NOT boost Rock Sp.Def — that's
  // gen 4.) Field-level, but applied per combatant here; the field countdown
  // itself happens once per turn in the battle loop.
  if (c.hp > 0 && field && field.weather === 'sand'
    && !c.types.includes('Rock') && !c.types.includes('Ground') && !c.types.includes('Steel')) {
    const d = Math.max(1, Math.floor(c.maxhp / 16));
    c.hp = Math.max(0, c.hp - d);
    log.push({ t: 'chip', target: c.name, cause: 'sandstorm', amount: d });
  }
}

/**
 * Simulate ONE battle. `a` is the challenger, `b` the champion/defender.
 * Returns { winner: 'a'|'b', turns, log }. On the turn cap, higher HP% wins;
 * an exact tie goes to 'b' (the reigning champion), per spec.
 */
export function simulateBattle(aSpec, bSpec, opts) {
  const { gen = 1, moves, chart, seed = 1, turnCap = DEFAULT_TURN_CAP } = opts;
  const rng = makeRng(seed);
  const a = makeCombatant(aSpec, gen, moves);
  const b = makeCombatant(bSpec, gen, moves);
  const field = { weather: null, weatherTurns: 0 }; // Simplified-moves: field-level weather
  const log = [{ t: 'start', a: a.name, b: b.name }];

  for (let turn = 1; turn <= turnCap; turn++) {
    log.push({ t: 'turn', n: turn });
    a.invulnThisTurn = false; b.invulnThisTurn = false; // reset — set fresh by doMove if a charge begins THIS turn

    const aChoice = chooseMoveForTurn(a, rng);
    const bChoice = chooseMoveForTurn(b, rng);
    const aPrio = aChoice.move ? aChoice.move.prio : 0;
    const bPrio = bChoice.move ? bChoice.move.prio : 0;
    const aSpd = effectiveSpeed(a), bSpd = effectiveSpeed(b);
    const aGoesFirst =
      aPrio !== bPrio ? aPrio > bPrio :
      aSpd !== bSpd ? aSpd > bSpd : chance(rng, 0.5);

    let first, second, firstChoice, secondChoice;
    if (aGoesFirst) { first = a; second = b; firstChoice = aChoice; secondChoice = bChoice; }
    else { first = b; second = a; firstChoice = bChoice; secondChoice = aChoice; }

    if (!firstChoice.move) { log.push({ t: 'recharge', target: first.name }); }
    else if (preMove(first, firstChoice.move, rng, log)) { doMove(first, second, firstChoice.move, rng, gen, chart, log, firstChoice.releasing, field); tickRampage(first, rng, log); }
    if (second.hp <= 0) { log.push({ t: 'faint', target: second.name }); return finish(a, b, log, turn); }

    if (!secondChoice.move) { log.push({ t: 'recharge', target: second.name }); }
    else if (preMove(second, secondChoice.move, rng, log)) { doMove(second, first, secondChoice.move, rng, gen, chart, log, secondChoice.releasing, field); tickRampage(second, rng, log); }
    if (first.hp <= 0) { log.push({ t: 'faint', target: first.name }); return finish(a, b, log, turn); }

    endOfTurn(first, log, field);
    endOfTurn(second, log, field);
    if (a.hp <= 0 || b.hp <= 0) {
      if (a.hp <= 0) log.push({ t: 'faint', target: a.name });
      if (b.hp <= 0) log.push({ t: 'faint', target: b.name });
      return finish(a, b, log, turn);
    }
    // Weather countdown — once per turn (not per combatant).
    if (field.weather && field.weatherTurns > 0) {
      field.weatherTurns--;
      if (field.weatherTurns === 0) { log.push({ t: 'weather-end', weather: field.weather }); field.weather = null; }
    }
  }
  // turn cap reached -> HP% tiebreak, champion wins exact ties
  log.push({ t: 'cap' });
  return finish(a, b, log, turnCap, true);
}

function finish(a, b, log, turns, cap = false) {
  let winner;
  if (a.hp <= 0 && b.hp <= 0) winner = 'b';            // double KO -> champion
  else if (a.hp <= 0) winner = 'b';
  else if (b.hp <= 0) winner = 'a';
  else {
    const aPct = a.hp / a.maxhp, bPct = b.hp / b.maxhp;
    winner = aPct > bPct ? 'a' : 'b';                  // tie -> champion ('b')
  }
  log.push({ t: 'end', winner, turns, cap, aHp: a.hp, bHp: b.hp });
  return { winner, turns, log };
}

/**
 * Run N silent simulations and report the challenger's win probability, plus a
 * single representative battle log (the first run) for step-by-step playback.
 * Use an odd N so a draft can never land on an exact 50/50 split.
 */
export function runMatch(aSpec, bSpec, opts) {
  const { n = 501, seed = 1 } = opts;
  let aWins = 0;
  let sampleLog = null;
  for (let i = 0; i < n; i++) {
    const res = simulateBattle(aSpec, bSpec, { ...opts, seed: (seed + i * 2654435761) >>> 0 });
    if (i === 0) sampleLog = res.log;
    if (res.winner === 'a') aWins++;
  }
  return {
    n,
    challengerWins: aWins,
    championWins: n - aWins,
    challengerWinPct: aWins / n,
    challengerBeatsChampion: aWins * 2 > n, // strict majority
    sampleLog,
  };
}

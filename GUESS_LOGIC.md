# PokéGuess — Guess Logic Reference

The single place to check **what the clue logic *should* do** versus **what it
actually does** in game. Applies to both generations (clue ids ≤ 26 are
identical across Gen 1 and Gen 2). Enforced in `docs/js/lib/engine.js`
(`clueAvailable`, `submitGuess`); current engine version when this was written:
**1.1.0**.

> How to use: play a round, try to reproduce each rule, and tick the **Verified**
> box (or write what you actually saw in **Notes**). A rule that's enforced means
> the clue is greyed/unavailable so you can't waste points buying it.

---

## Clue index (ids are stable across gens)

| id | Category | Clue | Field | Max uses |
|----|----------|------|-------|----------|
| 1 | Habitat | Pokédex Habitat | habitat | 1 |
| 2 | Habitat | Can Be Caught in the Wild | — | 1 |
| 3 | Habitat | Found by Walking | — | 1 |
| 4 | Habitat | Found by Surfing | — | 1 |
| 5 | Habitat | Found by Fishing | — | 1 |
| 6 | Habitat | Found by Headbutting Trees | — | 1 |
| 7 | Habitat | Obtained from NPC/Trade/Gift | — | 1 |
| 32 | Habitat | Generation | — | 1 |
| 8 | Evolution | Number of Family Members | familySize | 1 |
| 9 | Evolution | Current Evolution Stage | evoStage | 1 |
| 10 | Evolution | Can Evolve | canEvolve | 1 |
| 11 | Evolution | Evolves from Another Pokémon | evolvesFrom | 1 |
| 12 | Evolution | Evolution Method | evoMethod | 1 |
| 13 | Type | Reveal One Weakness | — | 6 |
| 14 | Type | Reveal One Resistance | — | 9 |
| 15 | Type | Has an Immunity | — | 1 |
| 16 | Type | Reveal One Type | — | 1 |
| 17 | Type | Reveal Second Type | — | 1 |
| 18 | Stats | Base Stat Total Range | — | 1 |
| 19 | Stats | Highest Base Stat | — | 1 |
| 20 | Stats | Highest Stat with Value | — | 1 |
| 21 | Stats | Lowest Base Stat | — | 1 |
| 22 | Stats | Lowest Stat with Value | — | 1 |
| 23 | Stats | Reveal Full Stat Spread | — | 1 |
| 24 | NPC Usage | Used by Any NPC Trainer | — | 1 |
| 25 | NPC Usage | Used by a Gym Leader | — | 1 |
| 26 | NPC Usage | Used by Elite Four/Red/Rival | — | 1 |
| 27 | NPC Usage | Used in Crystal Battle Tower | — | 1 |
| 28 | Movesets | Reveal One Example Moveset | — | ∞ |
| 29 | Movesets | Reveal One TM/HM Move | — | ∞ |
| 30 | Movesets | Reveal One Egg Move | — | ∞ |
| 31 | Movesets | Reveal a Competitive Moveset | — | 4 |
| 33 | Anime | First Anime Appearance | — | 1 |
| 34 | Anime | Acquisition / Evolution (Anime) | — | 1 |

Value vocabularies that the deduction rules rely on:
- `evoStage` ∈ { `single-stage`, `unevolved`, `middle`, `final` }
- `familySize` ∈ { `1`, `2`, `3` } · `canEvolve` / `evolvesFrom` ∈ { `Yes`, `No` }

---

## A. Prerequisites (must reveal X before Y)

| Rule | Expected | Status | Verified | Notes |
|------|----------|--------|----------|-------|
| 17 needs 16 | Can't reveal **Second Type** before **Reveal One Type** | ✅ enforced | ☐ | |
| 20 needs 19 | Can't reveal **Highest Stat value** before **Highest Base Stat** | ✅ enforced | ☐ | |
| 22 needs 21 | Can't reveal **Lowest Stat value** before **Lowest Base Stat** | ✅ enforced | ☐ | |

## B. Evolution deductions (the cluster behind bug #14)

The evolution facts are fully interlocked. The truth table:

| evoStage | canEvolve | evolvesFrom | familySize |
|----------|-----------|-------------|------------|
| single-stage | No | No | 1 |
| unevolved | Yes | No | ≥2 |
| middle | Yes | Yes | 3 |
| final | No | Yes | ≥2 |

| Rule | Expected | Status | Verified | Notes |
|------|----------|--------|----------|-------|
| Stage ⇒ Can Evolve | Revealing **Current Evolution Stage** locks **Can Evolve** (it's now known) | ✅ **fixed in 1.1.0** | ☐ | was the reported bug |
| Stage ⇒ Evolves From | Revealing **Current Evolution Stage** locks **Evolves From** | ✅ **fixed in 1.1.0** | ☐ | was the reported bug |
| (Can Evolve + Evolves From) ⇒ Stage | Revealing **both** locks **Current Evolution Stage** | ✅ **fixed in 1.1.0** | ☐ | |
| single-stage ⇒ family | Stage `single-stage` (or Can Evolve = No **and** Evolves From = No) locks **Number of Family Members** (= 1) | ✅ 1.1.0 | ☐ | |
| middle ⇒ family | Stage `middle` locks **Number of Family Members** (= 3) | ✅ 1.1.0 | ☐ | only 3-stage lines have a middle |
| family = 1 ⇒ all evo | If **Number of Family Members = 1**, lock Stage / Can Evolve / Evolves From / Method | ✅ pre-existing | ☐ | |
| Method needs "evolves from" | **Evolution Method** available only when it's known to evolve from something — Evolves From = Yes **or** Stage ∈ {middle, final} | ✅ 1.1.0 | ☐ | so Method still works after a stage reveal |

## C. Habitat / wild-encounter deductions

| Rule | Expected | Status | Verified | Notes |
|------|----------|--------|----------|-------|
| Wild gates encounters | Found by Walking/Surfing/Fishing/Headbutt locked unless **Can Be Caught in the Wild = Yes** | ✅ enforced | ☐ | |
| Encounter ⇒ wild | If any Found-by clue is **Yes**, lock **Can Be Caught in the Wild** (obviously Yes) | ✅ enforced | ☐ | |

## D. Type deductions

| Rule | Expected | Status | Verified | Notes |
|------|----------|--------|----------|-------|
| Both types ⇒ immunity | If **Reveal One Type** and **Reveal Second Type** are both shown, lock **Has an Immunity** (deducible from the type chart) | ✅ enforced | ☐ | |

## E. Stats deductions

| Rule | Expected | Status | Verified | Notes |
|------|----------|--------|----------|-------|
| Full spread ⇒ everything | After **Reveal Full Stat Spread**, lock BST Range / Highest / Highest-value / Lowest / Lowest-value | ✅ enforced | ☐ | |

## F. NPC-usage deductions

| Rule | Expected | Status | Verified | Notes |
|------|----------|--------|----------|-------|
| Not any NPC ⇒ not gym/E4 | If **Used by Any NPC Trainer = No**, lock **Gym Leader** and **Elite Four** | ✅ enforced | ☐ | |
| Gym/E4 ⇒ any NPC | If **Gym Leader = Yes** or **Elite Four ≠ No**, lock **Used by Any NPC** (obviously Yes) | ✅ enforced | ☐ | |

## G. Difficulty locks (per the guide)

| Rule | Expected | Status | Verified | Notes |
|------|----------|--------|----------|-------|
| Medium | Habitat & Anime categories hidden | ✅ config-driven | ☐ | |
| Hard | Habitat/Evolution/Trainers/Anime locked; Second Type locked; moveset limits | ✅ config-driven | ☐ | |
| Extreme | Hard + type reveals locked + Full Stat Spread locked | ✅ config-driven | ☐ | |

## H. Multi-use / exhaustion

| Rule | Expected | Status | Verified | Notes |
|------|----------|--------|----------|-------|
| Weaknesses | Up to 6 reveals; each new one different; cost rises per use | ✅ | ☐ | |
| Resistances | Up to 9 reveals; cost rises per use | ✅ | ☐ | |
| Egg moves | Cost rises per use; "no more" when pool exhausted | ✅ | ☐ | |
| Competitive moveset | Up to 4 total | ✅ | ☐ | |
| Pool exhaustion | TM/HM, egg, example, competitive say "no more…" and lock when their pool is empty | ✅ | ☐ | |

## I. Guess validity (bug #15)

| Rule | Expected | Status | Verified | Notes |
|------|----------|--------|----------|-------|
| Real names only | A guess must be an actual Pokémon from this generation's list (151 / 251). Unknown text is rejected with **no point penalty** (not counted as a wrong guess) | ✅ **added in 1.1.0** (engine) | ☐ | UI message + name-picker enforcement comes with the mode-file pass |
| Punctuation matters | "Farfetch'd", "Mr. Mime", "Ho-Oh", "Nidoran-F" must match exactly | ✅ | ☐ | |

---

### Open follow-ups (not yet enforced)
- The engine now *rejects* unknown guesses, but the individual guess screens
  (Single / Safari / Victory Road / Online) should also show a clear "pick a
  Pokémon from the list" message and ideally constrain the input to a picker.
  Tracked with the single-player UX pass.

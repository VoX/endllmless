# Playtest & LLM-Prompt Review

A hands-on play session of endllmless to surface gameplay issues and concrete
improvements to the LLM prompts. The game was played by driving the **exact live
prompt, schema, and model** (`google/gemini-2.5-flash-lite` via OpenRouter, same
system prompt and `json_schema` as `server/routes/wordCombine.js`) until **111
unique words** were discovered across **244 combines**, starting from the four
seed elements (Fire, Water, Earth, Wind). The cache-key normalization and prompt
word-ordering were replicated so results match production behavior.

**Headline:** the game itself is good — combinations are sensibly on-theme (Steam,
Mud, Lava, Obsidian, Fog, Acid Rain, Volcano, Mountain…) and the loop genuinely
feels like discovery. The issues below are about *consistency and polish*, not the
core idea.

## Summary stats

| metric | value |
| --- | --- |
| unique words reached | 111 |
| total combines | 244 |
| duplicate-collapse rate | 55% (combines returning an already-known word) |
| latency (median / max) | 0.54s / 14.55s |
| hard API errors | 1 (0.4%) |
| empty/multi/text emojis | several (see #3) |

---

## Findings (ranked by impact)

### 1. Consistency is an illusion — no temperature is set [HIGH]

Neither `wordCombine.js` nor `titleGenerator.js` passes a `temperature`, so the
model runs at its provider default (~1.0). The **only** thing making results look
stable is the in-memory `wordCache` — which is wiped on every server restart and
self-clears at 10,000 entries (`if (wordCache.size >= 10000) wordCache.clear();`).

On a cache miss, the same pair drifts badly. Measured by calling each pair three
times with no cache:

| pair | result 1 | result 2 | result 3 |
| --- | --- | --- | --- |
| Sun + Water | Ocean 🌊 | Rainbow 🌈 | Dew 💧 |
| Plant + Water | Flower 🌸 | Tree 🌳 | Root 🌱 |
| Stone + Stone | Rock 🪨 | Boulder 🪨 | Gravel 🪨 |
| Earth + Water | Mud 💩 | Mud 🏞️ | Mud 💩 (word stable, emoji drifts) |

**Why it matters:** two players — or the same player after a restart or after the
10k wipe — can combine the same things and get *different worlds*. This directly
breaks the "same inputs, same output" property that makes the game feel like a
learnable system rather than a slot machine.

**Fix:** set `temperature: 0` (or ~0.2) on **both** `chat.completions.create`
calls. One line each. This makes cache-miss results reproducible and survives
restarts/wipes, so the cache becomes a pure latency optimization instead of the
sole source of correctness.

### 2. Formatting drift forks the word space into duplicates [MEDIUM]

The client keys discovered words by their exact returned string, but the model is
inconsistent about case and spacing, so the same concept lands as **two different
collectible tiles**. Observed in a single session:

- `Acid Rain` **and** `AcidRain`
- `Poison Gas` **and** `Poison gas`

It also returns concatenations the "don't simply combine" rule is meant to prevent
(`AcidRain`, `Oceanliner`, `BoilingWater`) and ~7% two-word phrases despite the
schema saying "Single noun" (`Forest Fire`, `Tar Pit`, `Toxic Fumes`, `Scorched
Earth`, `Doused Fire`…). Many two-word results are legitimate compound nouns, but
the *inconsistency* is what creates the dupes.

**Fix:** pin the output format in the system prompt, e.g.:

> Respond with a single common noun in **Title Case**. If it is two words, separate
> them with a single space (e.g. "Acid Rain", never "AcidRain"). Use at most two
> words.

Optionally normalize server-side as a backstop (trim, collapse internal spaces,
Title-case) before caching, so any residual drift still collapses to one tile.

> **Status (iter2):** the prompt-side format pin SHIPPED (Title Case + single-space
> two-word rule, pinned by a test). The optional server-side normalization backstop
> (trim/collapse/Title-case before caching) is DEFERRED — the prompt rule is a soft
> constraint the model can still violate, so any residual case/space drift can still
> fork a tile until that backstop lands.

### 3. The emoji is the weak, unvalidated field [MEDIUM]

`newEmoji` is generated per-combine and the server validates only `newWord` (it
checks `typeof response.newWord === 'string' && response.newWord`, but never looks
at `newEmoji`). Consequences observed:

- **Same word, different icon by path.** "Shipwreck" came back as 🚢, 🔥, ⚓️, and
  🚢🔥 (two emojis) depending on which pair produced it — because the emoji is tied
  to the *combine*, not the *word*.
- **Empty emoji.** Peat Bog + Water → "Swamp" with an emoji of a single space →
  a blank tile in the collection.
- **Two emojis.** Fire + Oceanliner → "Shipwreck" 🚢🔥, violating the schema's
  "Exactly ONE emoji character."
- **Poor choice.** Earth + Water → "Mud" 💩 (this is what production returns).

**Fix (two parts):**
1. **Validate `newEmoji` server-side** like `newWord`: reject empty, multi-glyph,
   or text-containing values and fall back to a default (e.g. ❓) or re-request.
2. **Make the emoji canonical per word.** Cache/lookup the emoji keyed by the
   *result word*, so once "Shipwreck" has an icon, every path to Shipwreck shows
   the same one. (`temperature: 0` from #1 also reduces this drift.)

> **Status (iter2):** part 1 SHIPPED and was hardened — `validateEmoji` now rejects
> empty, whitespace, multi-glyph AND non-emoji single graphemes (a stray letter/
> digit/punct/CJK char) via `\p{Extended_Pictographic}`, falling back to ❓. Part 2
> (per-word canonical emoji keyed by the result word) is DEFERRED, so two paths to
> the same word can still show different valid icons; the related "don't permanently
> cache a fallback / allow a re-roll" tweak rides along with that map and is also
> deferred. `temperature: 0` on the combine route narrows but does not eliminate the
> cross-path drift.

---

## Minor / cosmetic

- **High convergence (55% collapse).** Many distinct pairs funnel to the same
  output (e.g. several paths → "Tar Pit", "Lava Rock", "Acid Rain"). This is partly
  inherent to a commonsense word game and shrinks the effective branching factor —
  worth watching but *not* worth over-tuning toward novelty, which would trade away
  the sensible-results quality. No action recommended now.
- **No timeout on the LLM call.** One combine took 14.5s (median is 0.54s). With no
  explicit timeout, a slow upstream hangs the request. Consider an ~8s timeout so
  rare slow calls fail fast into the existing error state instead of hanging.
- **Title generator.** Mostly good output, but it returned a duplicate ("VELVET"
  twice), occasionally fewer than the requested 50, and a misspelling ("ETHERIAL"
  for "ETHEREAL"). Purely cosmetic — the route cycles through whatever it gets.
  A server-side dedupe of the titles list would tidy it.
  > **Status (iter2):** server-side dedupe DEFERRED. Note: the title route is left
  > at a nonzero temperature ON PURPOSE — it serves a 1h-cached list round-robin and
  > needs variety, so `temperature: 0` (briefly applied in iter1) was reverted; a
  > dedupe would still be a nice tidy-up on top of that.

---

## Recommended order of work

1. **`temperature: 0` in both routes** — highest value, one line each, makes the
   world deterministic.
2. **Format pin in the wordCombine prompt** (+ optional server normalization) —
   kills duplicate tiles.
3. **Emoji validation + per-word canonical emoji** — removes blank/double/incoherent
   icons.

The first three are play-tested correctness/consistency bugs that feature-focused
work is unlikely to surface on its own.

---

## Appendix — method & sample

- **Instrument:** direct OpenRouter calls using the verbatim live system prompt and
  `json_schema`, model `google/gemini-2.5-flash-lite`, temperature left at default
  to match production. Pair ordering and cache key replicate the server.
- **Exploration:** breadth-first frontier expansion (combine freshly discovered
  words against the existing collection first) to maximize unique discoveries.
- **Consistency probe:** twelve representative pairs each called three times with no
  cache; 3 of 12 drifted at the word level and more drifted at the emoji level.

**The 111 discovered words:** Acid Rain, AcidRain, Adobe, Anchor, Anvil, Arson, Ash,
Ash Heap, Ashes, Asphalt, Beach, Boat, Boil, Boiler, BoilingWater, Bonfire, Brand,
Breeze, Brick, Charcoal, Clay, Corrosion, Dampness, Desert, Dew, Dilution, Dirt,
Doused Fire, Drought, Dune, Dust, Earth, Ember, Erosion, Extinguisher,
Extinguishment, Fire, Firestorm, Flame, Flood, Fog, Forest Fire, Forge, Foundation,
Furnace, Geyser, Heat haze, Heatwave, Hellfire, Illusion, Incendiary, Inferno, Ink,
Kiln, Lava, Lava Rock, Lavafall, Mirage, Mist, Mountain, Mud, Napalm, Oasis, Obsidian,
Ocean, Oceanliner, Oil Slick, Peat Bog, Poison, Poison gas, Pollution, Puddle, Pumice,
Quagmire, Rain, Rainbow, Road, Rust, Sand, Sandstorm, Scorched Earth, Sediment, Ship,
Shipwreck, Shovel, Sludge, Smear, Smog, Smoke, Soil, Solution, Soot, Steam, Steamboat,
Steamship, Sunbeam, Surf, Swamp, Tar Pit, Tattoo, Tornado, Toxic Fumes, Toxin, Tsunami,
Volcano, Wake, Water, Waterfall, Wave, Wildfire, Wind.

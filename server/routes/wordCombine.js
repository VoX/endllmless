import express from 'express';
import OpenAI from "openai";

const wordCache = new Map();

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://endless.claw.bitvox.me',
    'X-Title': 'endllmless'
  }
});
var router = express.Router();

const MAX_WORD_LEN = 40;

// Shown instead of a bad icon so a flawed emoji never produces a blank/garbled
// tile (the word is still good — see validateEmoji). The doc suggests a default
// such as a question-mark emoji.
const FALLBACK_EMOJI = '❓';

// Count user-perceived characters (graphemes). A single emoji can be several
// code points (ZWJ sequences like 👨‍👩‍👧, flags, skin-tone/variation modifiers),
// so a naive .length or even spread-then-count over-counts them. Intl.Segmenter
// with granularity 'grapheme' is the correct unit; fall back to a code-point
// count (Array.from) on the rare runtime without it.
const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
function graphemeCount(str) {
  if (segmenter) {
    let n = 0;
    for (const _ of segmenter.segment(str)) n++;
    return n;
  }
  return Array.from(str).length;
}

// Validate the model's emoji and return a safe value to cache/serve. The schema
// asks for exactly one emoji, but on OpenRouter the model still returns empty,
// whitespace-only, multi-glyph (e.g. "🚢🔥"), or plain-TEXT values (a stray "?",
// a lone letter/digit, a CJK char — all of which are a single grapheme and would
// otherwise sail through the count check and render verbatim as the tile icon).
// We never 502 on a bad emoji alone — the newWord is the valuable field — so on
// any failure we substitute FALLBACK_EMOJI rather than caching a blank/garbled/
// non-emoji tile. A valid single-grapheme emoji round-trips verbatim.
//
// The single-grapheme count check runs FIRST so multi-glyph still fails; the
// pictographic check then rejects non-emoji single graphemes. \p{Extended_Pictographic}
// matches the emoji base of keycaps/flags/ZWJ sequences too, so those still pass
// once they're a single grapheme. It deliberately does NOT re-run the C0/C1
// control-char strip from sanitizeWord — a single control/format char is not
// Extended_Pictographic, so it's already rejected here, and the json_schema
// constrains output regardless.
function validateEmoji(raw) {
  if (typeof raw !== 'string') return FALLBACK_EMOJI;
  const trimmed = raw.trim();
  if (!trimmed) return FALLBACK_EMOJI; // empty or whitespace-only
  if (graphemeCount(trimmed) !== 1) return FALLBACK_EMOJI; // multi-glyph
  if (!/\p{Extended_Pictographic}/u.test(trimmed)) return FALLBACK_EMOJI; // non-emoji text (letter/digit/punct/CJK)
  return trimmed;
}

// Normalize a raw query word for safe use in the prompt and cache key. Strips
// control chars (C0 \u0000-\u001F, DEL \u007F, C1 \u0080-\u009F), collapses
// any internal whitespace run to a single space, then trims. Returns null for
// non-strings (e.g. ?wordone=a&wordone=b yields an array) or anything that's
// empty/too long after cleanup, so the caller can 400. The endpoint is public
// and unauthenticated; this bounds prompt/token cost and cache-key abuse without
// affecting normal play (real words are short).
//
// Deliberately NOT neutralized (accepted as low-risk, pinned by tests):
//   - Double quotes / other prompt-structural chars: a crafted value can add
//     structure inside the `Combine: "..."` slot, but it's capped at 40 chars
//     and the system prompt constrains output to the word-game JSON schema, so
//     the blast radius is a slightly weirder word, not a real injection.
//   - Zero-width / format (Cf) chars (e.g. U+200B): not in the control range
//     and not matched by \s, so a zero-width-wrapped word survives as its own
//     distinct word/cache entry. Full Unicode normalization is out of scope;
//     the 40-char cap + 10k-entry clear bound the cache-pollution upside.
function sanitizeWord(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length > MAX_WORD_LEN) return null;
  return cleaned;
}

router.get('/', async (req, res, next) => {
  const rawOne = req.query?.wordone;
  const rawTwo = req.query?.wordtwo;

  if (!rawOne || !rawTwo) {
    next();
    return;
  }

  let wordOne = sanitizeWord(rawOne);
  let wordTwo = sanitizeWord(rawTwo);

  if (wordOne === null || wordTwo === null) {
    return res.status(400).json({ error: 'invalid input' });
  }

  if (wordOne > wordTwo) {
    [wordOne, wordTwo] = [wordTwo, wordOne];
  }

  // Normalize the cache key so case/whitespace variants collide on one entry:
  // "Fire", "fire", and " fire " all map to the same cached result. The lowered
  // pair is re-sorted because lowercasing can flip the ASCII order between an
  // uppercase-first and lowercase-first variant of the SAME pair, splitting them
  // across two entries without it. Example: the display sort keeps "Zoo"+"apple"
  // as ["Zoo","apple"] (Z=90 < a=97) but "Apple"+"zoo" as ["Apple","zoo"];
  // lowering gives ["zoo","apple"] vs ["apple","zoo"], so the final .sort() is
  // what makes both collapse to "apple+zoo". (Removing it still works for any
  // pair whose case-sensitive and case-insensitive ordering match.)
  const [keyOne, keyTwo] = [wordOne.toLowerCase(), wordTwo.toLowerCase()].sort();
  const cacheKey = `${keyOne}+${keyTwo}`;
  if (wordCache.has(cacheKey)) {
    return res.json(wordCache.get(cacheKey));
  }

  let completion;
  try {
    completion = await openai.chat.completions.create({
    model: "google/gemini-2.5-flash-lite",
    temperature: 0,
    messages: [
      {
        "role": "system",
        "content": `Play a word game. Rules:
- Combine two words into a new conceptual single noun.
- The word must be a noun.
- Do not simply combine the words unless it is a commonly used word.
- Prefer very commonplace and physical nouns.
- Choose the most commonsense interpretation.
- Respond with a single common noun in Title Case. If it is two words, separate them with a single space (e.g. "Acid Rain", never "AcidRain"). Use at most two words.
- Examples:
  - "Fire" + "Ice" = "Water"
  - "Water" + "Fire" = "Steam"
  - "Water" + "Earth" = "Mud"
  - "Fire" + "Fire" = "Volcano"
  - "Steam" + "Cloud" = "Rain"
  - "Death" + "Human" = "Corpse"
  - "Tomato" + "Bread" = "Pizza"
  - "Bread" + "Fire" = "Toast"
  - "Wind" + "Fire" = "Smoke"
  - "Smoke" + "Smoke" = "Cloud"`
      },
      {
        "role": "user",
        "content": `Combine: "${wordOne}" + "${wordTwo}"`
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "word_combination",
        strict: true,
        schema: {
          type: "object",
          properties: {
            newWord: {
              type: "string",
              description: "The resulting combined word. Single noun."
            },
            newEmoji: {
              type: "string",
              description: "Exactly ONE emoji character representing the new word — never more than one."
            }
          },
          required: ["newWord", "newEmoji"],
          additionalProperties: false
        }
      }
    }
    });
  } catch (error) {
    // Log only the safe diagnostic fields. The OpenAI SDK's APIError carries the
    // upstream RESPONSE headers as an enumerable property, which util.inspect
    // would dump verbatim (rate-limit counters, account/org hints, etc.) on every
    // failure; status + message + requestID keep the support signal without it.
    console.error("Error combining words:", error?.status, error?.message, error?.requestID);
    return res.status(502).json({ error: 'combination_failed' });
  }

  // Validate shape before parsing/caching: on OpenRouter, strict json_schema is
  // provider/model-dependent, and refusals/content-filters can yield null content
  // or empty choices. Don't poison the cache with a bad entry.
  let response;
  try {
    const content = completion?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('no completion content');
    response = JSON.parse(content);
    if (typeof response?.newWord !== 'string' || !response.newWord) {
      throw new Error('missing newWord');
    }
    // Validate the emoji too, but never 502 on it alone: a bad emoji is repaired
    // to FALLBACK_EMOJI so we cache/serve a good word with a safe icon instead of
    // a blank or double-glyph tile. The 502 path stays reserved for newWord.
    response.newEmoji = validateEmoji(response.newEmoji);
  } catch (error) {
    // This path catches validation/JSON.parse of an otherwise-successful
    // completion (a plain Error, no SDK response headers), but log just the
    // message for consistency with the SDK-error path above.
    console.error("Bad completion from model:", error?.message);
    return res.status(502).json({ error: 'combination_failed' });
  }

  // Bound memory under sustained novel/abusive input (Map has no native eviction).
  if (wordCache.size >= 10000) wordCache.clear();
  wordCache.set(cacheKey, response);
  res.json(response);
});

export default router;

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

// Normalize a raw query word for safe use in the prompt and cache key. Strips
// control chars (C0 \u0000-\u001F, DEL \u007F, C1 \u0080-\u009F), collapses
// any internal whitespace run to a single space, then trims. Returns null for
// non-strings (e.g. ?wordone=a&wordone=b yields an array) or anything that's
// empty/too long after cleanup, so the caller can 400. The endpoint is public
// and unauthenticated; this bounds prompt/token cost and cache-key abuse without
// affecting normal play (real words are short).
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
  // pair is re-sorted because lowercasing can change ASCII ordering relative to
  // the (already sorted) display words.
  const [keyOne, keyTwo] = [wordOne.toLowerCase(), wordTwo.toLowerCase()].sort();
  const cacheKey = `${keyOne}+${keyTwo}`;
  if (wordCache.has(cacheKey)) {
    return res.json(wordCache.get(cacheKey));
  }

  let completion;
  try {
    completion = await openai.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages: [
      {
        "role": "system",
        "content": `Play a word game. Rules:
- Combine two words into a new conceptual single noun.
- The word must be a noun.
- Do not simply combine the words unless it is a commonly used word.
- Prefer very commonplace and physical nouns.
- Choose the most commonsense interpretation.
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
              description: "A single emoji representing the new word."
            }
          },
          required: ["newWord", "newEmoji"],
          additionalProperties: false
        }
      }
    }
    });
  } catch (error) {
    console.error("Error combining words:", error);
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
  } catch (error) {
    console.error("Bad completion from model:", error);
    return res.status(502).json({ error: 'combination_failed' });
  }

  // Bound memory under sustained novel/abusive input (Map has no native eviction).
  if (wordCache.size >= 10000) wordCache.clear();
  wordCache.set(cacheKey, response);
  res.json(response);
});

export default router;

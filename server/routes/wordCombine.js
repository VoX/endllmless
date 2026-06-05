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

router.get('/', async (req, res, next) => {
  let wordOne = req.query?.wordone;
  let wordTwo = req.query?.wordtwo;

  if (!wordOne || !wordTwo) {
    next();
    return;
  }

  // Reject non-string (e.g. ?wordone=a&wordone=b yields an array) and overlong
  // input. The endpoint is public and unauthenticated; this bounds prompt/token
  // cost and cache-key abuse without affecting normal play (real words are short).
  if (typeof wordOne !== 'string' || typeof wordTwo !== 'string' ||
      wordOne.length > 40 || wordTwo.length > 40) {
    return res.status(400).json({ error: 'invalid input' });
  }

  if (wordOne > wordTwo) {
    [wordOne, wordTwo] = [wordTwo, wordOne];
  }

  const cacheKey = `${wordOne}+${wordTwo}`;
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

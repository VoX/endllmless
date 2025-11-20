import express from 'express';
import OpenAI from "openai";

const wordCache = new Map();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
var router = express.Router();

router.get('/', async (req, res, next) => {
  let wordOne = req.query?.wordone;
  let wordTwo = req.query?.wordtwo;

  if (!wordOne || !wordTwo) {
    next();
    return;
  }

  if (wordOne > wordTwo) {
    [wordOne, wordTwo] = [wordTwo, wordOne];
  }

  if (wordCache.has(`${wordOne}+${wordTwo}`)) {
    const cachedResponse = wordCache.get(`${wordOne}+${wordTwo}`);
    return res.json(cachedResponse);
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-5.1",
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

  const response = JSON.parse(completion.choices[0].message.content);

  wordCache.set(`${wordOne}+${wordTwo}`, response);
  res.json(response);
});

export default router;

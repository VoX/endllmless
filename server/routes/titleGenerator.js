import express from 'express';
import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
var router = express.Router();

let titleCache = [];
let currentIndex = 0;
let lastFetchTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

router.get('/', async (req, res, next) => {
    const now = Date.now();
    if (titleCache.length === 0 || (now - lastFetchTime > CACHE_DURATION)) {
        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-5.1",
                messages: [
                    {
                        "role": "system",
                        "content": "Generate 50 unique, interesting, and slightly abstract words or short phrases to complete the sentence 'CRAFT [WORD] THINGS'. Return ONLY the [WORD] part. Do NOT include the words 'CRAFT' or 'THINGS' in the output. The words should be adjectives or nouns acting as adjectives. Examples: 'INFINITE', 'ETERNAL', 'COSMIC', 'FORBIDDEN', 'MYSTERIOUS', 'QUANTUM', 'ELDRITCH', 'BOUNDLESS'."
                    }
                ],
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "title_list",
                        strict: true,
                        schema: {
                            type: "object",
                            properties: {
                                titles: {
                                    type: "array",
                                    items: {
                                        type: "string"
                                    }
                                }
                            },
                            required: ["titles"],
                            additionalProperties: false
                        }
                    }
                }
            });
            const data = JSON.parse(completion.choices[0].message.content);
            console.log("generated titles:", data.titles);
            titleCache = data.titles.map(t => t.replace(/^CRAFT\s+/i, '').replace(/\s+THINGS$/i, ''));
            currentIndex = 0;
            lastFetchTime = Date.now();
        } catch (error) {
            console.error("Error generating titles:", error);
            return res.json({ title: "ENDLESS" });
        }
    }

    const title = titleCache[currentIndex % titleCache.length];
    currentIndex++;
    res.json({ title });
});

export default router;

import express from 'express';
import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
        'HTTP-Referer': 'https://endless.claw.bitvox.me',
        'X-Title': 'endllmless'
    }
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
                model: "openai/gpt-4o-mini",
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
            const content = completion?.choices?.[0]?.message?.content;
            if (typeof content !== 'string') throw new Error('no completion content');
            const data = JSON.parse(content);
            console.log("generated titles:", data?.titles);
            const titles = (data?.titles || [])
                .map(t => String(t).replace(/^CRAFT\s+/i, '').replace(/\s+THINGS$/i, '').trim())
                .filter(t => t.length);
            // Treat an empty/invalid result as a failure so we fall into the catch
            // and return the ENDLESS fallback instead of poisoning the cache with []
            // (which would make currentIndex % 0 = NaN AND re-hit the paid API on
            // every poll, since titleCache.length === 0 stays true forever).
            if (!titles.length) throw new Error('no titles');
            titleCache = titles;
            currentIndex = 0;
            lastFetchTime = Date.now();
        } catch (error) {
            console.error("Error generating titles:", error);
            return res.json({ title: "ENDLESS" });
        }
    }

    const title = titleCache.length ? titleCache[currentIndex++ % titleCache.length] : "ENDLESS";
    res.json({ title });
});

export default router;

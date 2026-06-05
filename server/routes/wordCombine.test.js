import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';

// Mock the OpenAI SDK so the route never touches the network. vi.mock is hoisted
// above the imports, so the shared mock fn is created via vi.hoisted to stay in
// scope inside the factory.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('openai', () => {
  // The route does `new OpenAI(...)` then `openai.chat.completions.create(...)`.
  class MockOpenAI {
    constructor() {
      this.chat = { completions: { create: createMock } };
    }
  }
  return { default: MockOpenAI };
});

// Default a successful, well-formed completion. Individual tests can override.
function okCompletion(newWord = 'Steam', newEmoji = '') {
  return {
    choices: [{ message: { content: JSON.stringify({ newWord, newEmoji }) } }],
  };
}

let app;
let server;
let baseUrl;

// Import the router AFTER the mock is registered (it is, since vi.mock hoists),
// inside beforeEach via dynamic import so each test gets a fresh module instance
// with an empty in-memory cache.
beforeEach(async () => {
  vi.resetModules();
  createMock.mockReset();
  createMock.mockResolvedValue(okCompletion());

  const { default: wordCombineRouter } = await import('./wordCombine.js');
  app = express();
  app.use('/api/wordcombine', wordCombineRouter);
  // Fallthrough so we can observe the router calling next() (missing params).
  app.use((req, res) => res.status(404).json({ error: 'not_found' }));

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const get = (qs) => fetch(`${baseUrl}/api/wordcombine?${qs}`);

describe('wordCombine route: input validation', () => {
  it('falls through (404) when a word is missing', async () => {
    const res = await get('wordone=fire');
    expect(res.status).toBe(404);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects array params (?wordone=a&wordone=b) with 400', async () => {
    const res = await get('wordone=a&wordone=b&wordtwo=water');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid input' });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects an overlong word (>40 chars after trimming) with 400', async () => {
    const long = 'a'.repeat(41);
    const res = await get(`wordone=${long}&wordtwo=water`);
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects a word that is only whitespace/control chars with 400', async () => {
    // %09 = tab, %20 = space: collapses+trims to empty -> invalid.
    const res = await get('wordone=%09%20%20&wordtwo=water');
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('accepts a word at the 40-char boundary', async () => {
    const ok = 'a'.repeat(40);
    const res = await get(`wordone=${ok}&wordtwo=water`);
    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

describe('wordCombine route: sanitization in the prompt', () => {
  it('trims and collapses whitespace before building the prompt', async () => {
    const res = await get('wordone=%20%20Fire%20%20&wordtwo=multi%20%20%20word');
    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(1);

    const userMsg = createMock.mock.calls[0][0].messages[1].content;
    // Words are sorted alphabetically (Fire < multi word) and cleaned of the
    // extra whitespace before interpolation.
    expect(userMsg).toBe('Combine: "Fire" + "multi word"');
  });
});

describe('wordCombine route: cache-key normalization', () => {
  it('treats "Fire"/"fire"/" fire " as one cache entry (single LLM call)', async () => {
    const variants = ['wordone=Fire&wordtwo=Ice', 'wordone=fire&wordtwo=ice', 'wordone=%20fire%20&wordtwo=Ice'];

    const bodies = [];
    for (const qs of variants) {
      const res = await get(qs);
      expect(res.status).toBe(200);
      bodies.push(await res.json());
    }

    // The model is only invoked for the first variant; the rest are cache hits.
    expect(createMock).toHaveBeenCalledTimes(1);
    // And every variant returns the same cached payload.
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it('normalizes pair order so swapped words also hit the same entry', async () => {
    await get('wordone=Fire&wordtwo=Water');
    await get('wordone=water&wordtwo=fire');

    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('still distinguishes genuinely different pairs (separate LLM calls)', async () => {
    createMock.mockResolvedValueOnce(okCompletion('Steam', ''));
    createMock.mockResolvedValueOnce(okCompletion('Mud', ''));

    await get('wordone=fire&wordtwo=water');
    await get('wordone=earth&wordtwo=water');

    expect(createMock).toHaveBeenCalledTimes(2);
  });
});

describe('wordCombine route: upstream failures', () => {
  it('returns 502 and does not cache when the model output is malformed', async () => {
    // Missing newWord -> route rejects the body.
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ newEmoji: '' }) } }],
    });

    const bad = await get('wordone=fire&wordtwo=lava');
    expect(bad.status).toBe(502);

    // A subsequent identical request must retry (nothing poisoned the cache),
    // and this time the model returns a valid body.
    createMock.mockResolvedValueOnce(okCompletion('Obsidian', ''));
    const good = await get('wordone=fire&wordtwo=lava');
    expect(good.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';

// The suite drives the route over HTTP via the global fetch (Node 18+). Fail
// loudly with an actionable message on an older runtime instead of an opaque
// "fetch is not defined" mid-test.
if (typeof fetch !== 'function') {
  throw new Error('These tests require a global fetch (Node 18+). Upgrade Node.');
}

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
  // Guard against a test that throws before the listener binds: closing an
  // undefined server here would mask the real failure with a secondary error.
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
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

  it('collapses a mixed-case pair whose ASCII order flips after lowercasing', async () => {
    // Guards the FINAL .sort() on the lowered key. The display sort keeps
    // "Zoo"+"apple" as [Zoo, apple] (Z<a) but "Apple"+"zoo" as [Apple, zoo];
    // only re-sorting the lowered pair makes both collapse to "apple+zoo".
    // Every other test pair has matching case-sensitive/insensitive order, so
    // this is the one case that fails if the final .sort() is removed.
    await get('wordone=Zoo&wordtwo=apple');
    await get('wordone=Apple&wordtwo=zoo');

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

describe('wordCombine route: deterministic generation (temperature)', () => {
  it('passes temperature: 0 on the chat.completions.create call', async () => {
    // Determinism fix from the playtest: without temperature: 0 the same pair
    // drifts across cache wipes/restarts (Sun+Water -> Ocean/Rainbow/Dew).
    const res = await get('wordone=fire&wordtwo=water');
    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].temperature).toBe(0);
  });
});

describe('wordCombine route: system prompt format pin', () => {
  it('instructs the model to use Title Case with single-space two-word output', async () => {
    // Pins the format rule that collapses the Acid Rain / AcidRain dupe forks.
    const res = await get('wordone=acid&wordtwo=rain');
    expect(res.status).toBe(200);

    const systemMsg = createMock.mock.calls[0][0].messages[0].content;
    expect(systemMsg).toContain('Title Case');
    expect(systemMsg).toContain('single space');
  });
});

describe('wordCombine route: emoji validation', () => {
  it('substitutes a single fallback glyph for an empty emoji (still 200, cached)', async () => {
    // A blank/whitespace emoji must NOT 502 (the word is good) and must NOT be
    // cached as-is — it becomes the fallback so the tile is never blank.
    createMock.mockResolvedValueOnce(okCompletion('Swamp', '   '));

    const res = await get('wordone=peat&wordtwo=water');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.newWord).toBe('Swamp');
    expect(body.newEmoji).toBe('❓');

    // The repaired (not the bad) value is what's cached: a repeat is a hit and
    // replays the fallback glyph, with no second model call.
    const repeat = await (await get('wordone=Water&wordtwo=Peat')).json();
    expect(repeat).toEqual(body);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('substitutes a single fallback glyph for a multi-glyph emoji (still 200)', async () => {
    // Two-emoji values like "🚢🔥" violate "exactly one emoji" -> fallback.
    createMock.mockResolvedValueOnce(okCompletion('Shipwreck', '🚢🔥'));

    const res = await get('wordone=fire&wordtwo=oceanliner');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ newWord: 'Shipwreck', newEmoji: '❓' });
  });

  it('passes a valid multi-codepoint single-grapheme emoji through verbatim', async () => {
    // 🌧️ is a ZWJ/variation-selector emoji (2 code points, 1 grapheme): a
    // naive code-unit/code-point length would wrongly reject it. It must survive.
    createMock.mockResolvedValueOnce(okCompletion('Rain', '🌧️'));

    const res = await get('wordone=steam&wordtwo=cloud');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ newWord: 'Rain', newEmoji: '🌧️' });
  });
});

describe('wordCombine route: success response body', () => {
  it('round-trips the model payload (newWord + newEmoji) to the client verbatim', async () => {
    createMock.mockResolvedValueOnce(okCompletion('Steam', '💨'));

    const res = await get('wordone=fire&wordtwo=water');
    expect(res.status).toBe(200);
    // Pins the exact body shape: an accidental wrapper, transform, or dropped
    // field would slip past the equality-to-each-other cache assertions.
    expect(await res.json()).toEqual({ newWord: 'Steam', newEmoji: '💨' });
  });

  it('caches and replays that exact payload on a repeat request', async () => {
    createMock.mockResolvedValueOnce(okCompletion('Mud', '🟤'));

    const first = await (await get('wordone=earth&wordtwo=water')).json();
    const second = await (await get('wordone=Water&wordtwo=Earth')).json();

    expect(first).toEqual({ newWord: 'Mud', newEmoji: '🟤' });
    expect(second).toEqual(first);
    expect(createMock).toHaveBeenCalledTimes(1);
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

  it('returns 502 and does not poison the cache when the SDK throws (network)', async () => {
    // The most likely production failure, and the one that proves the mock
    // never hit the network even on the error path.
    createMock.mockRejectedValueOnce(new Error('network'));

    const bad = await get('wordone=fire&wordtwo=cloud');
    expect(bad.status).toBe(502);

    // Identical request retries against the (now succeeding) model.
    createMock.mockResolvedValueOnce(okCompletion('Rain', '🌧️'));
    const good = await get('wordone=fire&wordtwo=cloud');
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({ newWord: 'Rain', newEmoji: '🌧️' });
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('returns 502 when message content is null (refusal / content filter)', async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: null } }] });

    const bad = await get('wordone=fire&wordtwo=void');
    expect(bad.status).toBe(502);
  });
});

describe('wordCombine route: sanitization (pinned current behavior)', () => {
  it('passes double quotes through into the prompt unescaped (accepted low-risk)', async () => {
    // Pins the deliberate decision NOT to strip prompt-structural chars. If a
    // future change starts escaping/stripping quotes, this assertion flips and
    // forces the decision to be revisited.
    const res = await get('wordone=a%22%20%2B%20%22b&wordtwo=water');
    expect(res.status).toBe(200);

    const userMsg = createMock.mock.calls[0][0].messages[1].content;
    // Sorted alphabetically: 'a" + "b' < 'water'.
    expect(userMsg).toBe('Combine: "a" + "b" + "water"');
  });

  it('treats a zero-width-wrapped word as DISTINCT from the bare word', async () => {
    // U+200B is neither a control char nor matched by \s, so it survives
    // sanitization -> separate cache key -> separate LLM call. Pins that
    // Unicode-format normalization is currently out of scope.
    await get('wordone=%E2%80%8Bfire%E2%80%8B&wordtwo=water');
    await get('wordone=fire&wordtwo=water');

    expect(createMock).toHaveBeenCalledTimes(2);
  });
});

describe('rate limiter (server/app.js middleware)', () => {
  let rlServer;
  let rlBase;

  // Build an app that mounts the real rateLimit middleware in front of the
  // (mocked) wordCombine router, mirroring app.js. Fresh import per test so the
  // module-level rateHits counter starts empty.
  async function buildRateLimitedApp() {
    const { rateLimit, RATE_MAX } = await import('../app.js');
    const { default: wordCombineRouter } = await import('./wordCombine.js');
    const a = express();
    a.set('trust proxy', 1); // honor X-Forwarded-For like behind Caddy
    a.use('/api/', rateLimit);
    a.use('/api/wordcombine', wordCombineRouter);
    a.use((req, res) => res.status(404).json({ error: 'not_found' }));
    await new Promise((resolve) => {
      rlServer = a.listen(0, () => {
        rlBase = `http://127.0.0.1:${rlServer.address().port}`;
        resolve();
      });
    });
    return RATE_MAX;
  }

  afterEach(async () => {
    if (rlServer) {
      await new Promise((resolve) => rlServer.close(resolve));
      rlServer = undefined;
    }
  });

  it('allows RATE_MAX requests then 429s with a numeric Retry-After', async () => {
    const max = await buildRateLimitedApp();
    // A single distinct pair is enough: rateLimit runs before the router, so
    // even cache hits increment the counter.
    const url = `${rlBase}/api/wordcombine?wordone=fire&wordtwo=water`;

    for (let i = 0; i < max; i++) {
      const res = await fetch(url);
      expect(res.status).toBe(200);
    }
    const limited = await fetch(url);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });

    const retryAfter = limited.headers.get('retry-after');
    expect(retryAfter).not.toBeNull();
    expect(Number.isNaN(Number(retryAfter))).toBe(false);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it('keys the window per-IP off X-Forwarded-For (trust proxy)', async () => {
    const max = await buildRateLimitedApp();
    const url = `${rlBase}/api/wordcombine?wordone=fire&wordtwo=water`;

    // Drain client A to its limit.
    for (let i = 0; i < max; i++) {
      const res = await fetch(url, { headers: { 'X-Forwarded-For': '203.0.113.1' } });
      expect(res.status).toBe(200);
    }
    expect((await fetch(url, { headers: { 'X-Forwarded-For': '203.0.113.1' } })).status).toBe(429);

    // A different forwarded IP has its own untouched counter.
    expect((await fetch(url, { headers: { 'X-Forwarded-For': '203.0.113.2' } })).status).toBe(200);
  });
});

import createError from 'http-errors';
import express from 'express';
import path from 'path';
import logger from 'morgan';
import { fileURLToPath } from 'url';

import wordCombineRouter from './routes/wordCombine.js';
import titleGeneratorRouter from './routes/titleGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

var app = express();

// Caddy reverse-proxies /api/* and sets X-Forwarded-For, so trust the proxy in
// front of us to key the rate limiter off the real client IP (not localhost).
app.set('trust proxy', 1);

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// Lightweight per-IP rate limiter for the unauthenticated, paid LLM endpoints.
// Each novel /api/wordcombine request is a real billed OpenRouter call, so this
// caps how fast a single client can drain the API budget. Tiny in-memory
// fixed-window counter (no dependency); fine for a single-process word game.
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 30;
const rateHits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const ip = req.ip || 'unknown';
  let entry = rateHits.get(ip);
  if (!entry || now > entry.reset) {
    entry = { count: 0, reset: now + RATE_WINDOW_MS };
    rateHits.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_MAX) {
    res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
    return res.status(429).json({ error: 'rate_limited' });
  }
  // Opportunistic cleanup so the Map can't grow unbounded across many IPs.
  if (rateHits.size > 5000) {
    for (const [k, v] of rateHits) if (now > v.reset) rateHits.delete(k);
  }
  next();
}
app.use('/api/', rateLimit);

app.use('/api/wordcombine', wordCombineRouter);
app.use('/api/title', titleGeneratorRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.json({ "error": err.status });
});

export default app;

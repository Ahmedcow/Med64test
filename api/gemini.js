// api/gemini.js
//
// Server-side Gemini proxy for Med64.
// The Gemini API key lives only here, as a Vercel environment variable —
// it is never sent to or stored in a visitor's browser. The client
// (index.html) calls this endpoint at /api/gemini instead of calling
// Google directly.
//
// Required environment variable (Vercel > Project > Settings > Environment Variables):
//   GEMINI_API_KEY          Your Google AI Studio / Gemini API key.
//
// Optional environment variables:
//   GEMINI_MODEL            Default model id used when the client doesn't override one.
//                            Defaults to "gemini-3.6-flash".
//   GEMINI_ALLOWED_MODELS   Comma-separated allow-list of model ids clients may request
//                            via the optional "Model override" field in the UI.
//                            If unset, any model id the client sends is used as-is.
//   ACCESS_CODE             Optional shared passphrase. If set, every request must
//                            include a matching "x-access-code" header. Share this
//                            code only with people you want to allow to use the AI
//                            features, to protect your Gemini quota/billing.
//   ALLOWED_ORIGIN           Optional explicit origin to allow, e.g.
//                            "https://your-site.vercel.app". If unset, the function
//                            allows same-origin requests (matching req.headers.host)
//                            whenever an Origin/Referer header is present.
//
// Security note: this is a best-effort public proxy, not a full auth system.
// The origin check and rate limit below reduce casual abuse from browsers, but a
// determined caller can still hit this endpoint directly. For a public deployment,
// also set a spending cap on the Google Cloud project tied to GEMINI_API_KEY, and
// consider setting ACCESS_CODE if you want to restrict usage to people you trust.

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX = 30; // requests per window per IP (best-effort; resets on cold start)
const hits = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    hits.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  // --- Best-effort same-origin check ---
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const origin = req.headers.origin || req.headers.referer || '';
  const host = req.headers.host || '';
  if (allowedOrigin) {
    if (!origin || !origin.startsWith(allowedOrigin)) {
      res.status(403).json({ error: 'Origin not allowed.' });
      return;
    }
  } else if (origin && host && !origin.includes(host)) {
    res.status(403).json({ error: 'Origin not allowed.' });
    return;
  }

  // --- Optional shared access code ---
  if (process.env.ACCESS_CODE) {
    const provided = req.headers['x-access-code'];
    if (provided !== process.env.ACCESS_CODE) {
      res.status(401).json({ error: 'Missing or incorrect access code.' });
      return;
    }
  }

  // --- Best-effort per-IP rate limit ---
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing GEMINI_API_KEY. Set it in the Vercel project environment variables.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const { contents, generationConfig, model: requestedModel } = body;
  if (!Array.isArray(contents) || !contents.length) {
    res.status(400).json({ error: 'Missing "contents" in request body.' });
    return;
  }

  const allowList = (process.env.GEMINI_ALLOWED_MODELS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  let model = String(requestedModel || process.env.GEMINI_MODEL || 'gemini-3.6-flash').trim();
  if (allowList.length && !allowList.includes(model)) {
    model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  }

  // Clamp generation config so a single request can't run away with tokens/cost.
  // Gemini 3.x deprecates the old sampling temperature parameter, so keep this
  // proxy compatible with the current Gemini 3.x API by sending only supported
  // output controls.
  const safeGenerationConfig = {
    maxOutputTokens: Math.min(Number(generationConfig?.maxOutputTokens) || 4096, 16384),
    responseMimeType: 'application/json'
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig: safeGenerationConfig })
    });
    const data = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      const message = (data && data.error && data.error.message) || `Gemini responded with HTTP ${upstream.status}`;
      res.status(upstream.status).json({ error: message });
      return;
    }

    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const text = Array.isArray(parts) ? parts.map(p => p.text || '').join('') : '';

    if (!text) {
      res.status(502).json({ error: 'The model returned an empty response.' });
      return;
    }

    res.status(200).json({ text, model });
  } catch (e) {
    res.status(502).json({ error: 'Failed to reach Gemini: ' + e.message });
  }
};

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function cleanModelName(name) {
  return String(name || '').replace(/^models\//, '').trim();
}

async function readJson(res) {
  try { return await res.json(); } catch (_) { return null; }
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  return { res, data: await readJson(res) };
}

async function listFallbackModel(apiKey) {
  const { res, data } = await fetchJson(`${API_BASE}/models?key=${encodeURIComponent(apiKey)}`);
  if (!res.ok || !Array.isArray(data?.models)) return null;
  const usable = data.models.filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'));
  const preferred = [
    process.env.GEMINI_MODEL,
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash'
  ].map(cleanModelName).filter(Boolean);
  for (const wanted of preferred) {
    const hit = usable.find(m => cleanModelName(m.name) === wanted);
    if (hit) return cleanModelName(hit.name);
  }
  const flash = usable.find(m => /flash/i.test(m.name || ''));
  return flash ? cleanModelName(flash.name) : (usable[0] ? cleanModelName(usable[0].name) : null);
}

async function generate(apiKey, model, body) {
  const modelName = cleanModelName(model);
  const url = `${API_BASE}/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY is missing in Vercel Environment Variables.' });
    return;
  }
  const { contents, generationConfig, model } = req.body || {};
  if (!Array.isArray(contents) || !contents.length) {
    res.status(400).json({ error: 'Missing AI contents.' });
    return;
  }

  const requested = cleanModelName(model || process.env.GEMINI_MODEL || 'gemini-2.5-flash');
  const body = { contents, generationConfig: generationConfig || {} };
  let result = await generate(apiKey, requested, body);

  if (!result.res.ok && (result.res.status === 400 || result.res.status === 404)) {
    const fallback = await listFallbackModel(apiKey);
    if (fallback && fallback !== requested) result = await generate(apiKey, fallback, body);
  }

  if (!result.res.ok) {
    const message = result.data?.error?.message || result.data?.error || `Gemini API HTTP ${result.res.status}`;
    res.status(result.res.status).json({ error: message });
    return;
  }

  const parts = result.data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p?.text || '').join('').trim();
  if (!text) {
    res.status(502).json({ error: 'Gemini returned no text.' });
    return;
  }
  res.status(200).json({ text, model: result.data?.modelVersion || requested });
};

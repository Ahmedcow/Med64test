function cleanModelName(model) {
  return String(model || '').trim().replace(/^['"]|['"]$/g, '');
}

async function callGroq(apiKey, model, messages, responseFormat) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      response_format: responseFormat || { type: 'json_object' }
    })
  });
  let data = null;
  try { data = await r.json(); } catch (_) {}
  return { r, data };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GROQ_API_KEY is missing in Vercel Environment Variables.' });
    return;
  }

  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) {
    res.status(400).json({ error: 'Missing AI messages.' });
    return;
  }

  const model = cleanModelName(body.model || process.env.GROQ_MODEL || 'openai/gpt-oss-120b');
  const responseFormat = body.responseFormat || { type: 'json_object' };

  let result = await callGroq(apiKey, model, messages, responseFormat);

  if (!result.r.ok) {
    const message = result.data?.error?.message || result.data?.error || `Groq API HTTP ${result.r.status}`;
    res.status(result.r.status).json({ error: message });
    return;
  }

  const text = result.data?.choices?.[0]?.message?.content;
  if (!text) {
    res.status(502).json({ error: 'Groq returned no text.' });
    return;
  }

  res.status(200).json({
    text,
    model: result.data?.model || model,
    provider: 'groq'
  });
};

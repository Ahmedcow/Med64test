export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const body = req.body || {};
  const provider = String(body.provider || 'groq').trim().toLowerCase();
  const model = String(body.model || '').trim();
  const contents = Array.isArray(body.contents) ? body.contents : [];
  const generationConfig = body.generationConfig || {};

  if (!contents.length) return res.status(400).json({ error: 'No AI messages were provided.' });

  const messages = contents.map((item) => ({
    role: item.role === 'model' ? 'assistant' : (item.role || 'user'),
    content: Array.isArray(item.parts)
      ? item.parts.map(p => String(p?.text || '')).join('\n')
      : String(item.content || '')
  })).filter(m => m.content.trim());

  if (!messages.length) return res.status(400).json({ error: 'The AI request contained no text.' });

  try {
    let result;
    if (provider === 'groq') {
      result = await callOpenAICompatible({
        apiKey: process.env.GROQ_API_KEY,
        url: 'https://api.groq.com/openai/v1/chat/completions',
        model: model || 'openai/gpt-oss-120b',
        messages,
        generationConfig,
        providerName: 'Groq'
      });
    } else if (provider === 'openrouter') {
      result = await callOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
        requestedModel: model,
        messages,
        generationConfig
      });
    } else if (provider === 'gemini') {
      result = await callGemini({
        apiKey: process.env.GEMINI_API_KEY,
        model: model || 'gemini-3.6-flash',
        messages,
        generationConfig
      });
    } else {
      return res.status(400).json({ error: 'Unsupported AI provider.' });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Multi-provider AI error:', error);
    const status = Number(error?.status) || 500;
    return res.status(status).json({ error: error.message || 'AI request failed.' });
  }
}

async function callOpenRouter({ apiKey, requestedModel, messages, generationConfig }) {
  if (!apiKey) throw new Error('OpenRouter API credentials are not configured in Vercel Environment Variables.');

  const wantsJson = generationConfig.jsonMode === true;
  // These two free Gemma endpoints currently advertise JSON response support.
  // openrouter/free also filters for structured-output capable free models.
  const jsonModels = new Set([
    'google/gemma-4-31b-it:free',
    'google/gemma-4-26b-a4b-it:free',
    'openrouter/free'
  ]);
  const effectiveModel = wantsJson
    ? (jsonModels.has(requestedModel) ? requestedModel : 'google/gemma-4-31b-it:free')
    : (requestedModel || 'openrouter/free');

  const requestedTokens = Number(generationConfig.maxOutputTokens);
  const maxTokens = Number.isFinite(requestedTokens) && requestedTokens > 0
    ? Math.min(requestedTokens, wantsJson ? 3000 : 65536)
    : (wantsJson ? 3000 : 4096);

  const payload = {
    model: effectiveModel,
    messages,
    temperature: wantsJson ? 0.15 : 0.35,
    max_tokens: maxTokens
  };

  if (wantsJson) {
    // json_object is supported by Gemma 4 31B/26B on OpenRouter.
    // For openrouter/free, require_parameters prevents routing to a provider
    // that ignores the requested structured-output parameter.
    payload.response_format = { type: 'json_object' };
    payload.plugins = [{ id: 'response-healing' }];
    payload.provider = { require_parameters: true };
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://med64test.vercel.app',
      'X-Title': 'MedEx Medical Examination Platform'
    },
    body: JSON.stringify(payload)
  });

  let data = null;
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) {
    let message = data?.error?.message || data?.error || `OpenRouter returned HTTP ${response.status}.`;
    if (response.status === 402) message += ' Check that the selected OpenRouter model is free and that your key has free-model access.';
    if (response.status === 400 && wantsJson) message += ' The selected free model/provider did not accept JSON output. MedEx will use Gemma 4 31B on the next retry.';
    const err = new Error(String(message));
    err.status = response.status;
    throw err;
  }

  const choice = data?.choices?.[0];
  const text = choice?.message?.content;
  if (!text) {
    const finish = choice?.finish_reason ? ` Finish reason: ${choice.finish_reason}.` : '';
    throw new Error(`OpenRouter returned no text content.${finish}`);
  }

  return {
    text,
    model: data?.model || effectiveModel,
    provider: 'OpenRouter',
    finishReason: choice?.finish_reason || null
  };
}

async function callOpenAICompatible({ apiKey, url, model, messages, generationConfig, providerName }) {
  if (!apiKey) throw new Error(`${providerName} API credentials are not configured in Vercel Environment Variables.`);

  const requestedTokens = Number(generationConfig.maxOutputTokens);
  const maxTokens = Number.isFinite(requestedTokens) && requestedTokens > 0
    ? Math.min(requestedTokens, 65536)
    : 4096;

  const payload = {
    model,
    messages,
    temperature: 0.35,
    max_completion_tokens: maxTokens
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  let data = null;
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) {
    const message = data?.error?.message || data?.error || `${providerName} returned HTTP ${response.status}.`;
    const err = new Error(String(message));
    err.status = response.status;
    throw err;
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${providerName} returned no text content.`);
  return { text, model: data?.model || model, provider: providerName };
}

async function callGemini({ apiKey, model, messages, generationConfig }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured in Vercel Environment Variables.');

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const payload = {
    contents,
    generationConfig: {
      maxOutputTokens: Number(generationConfig.maxOutputTokens) > 0
        ? Math.min(Number(generationConfig.maxOutputTokens), 65536)
        : 4096
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let data = null;
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) {
    const message = data?.error?.message || `Gemini returned HTTP ${response.status}.`;
    const err = new Error(String(message));
    err.status = response.status;
    throw err;
  }

  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text) throw new Error('Gemini returned no text content.');
  return { text, model, provider: 'Google Gemini' };
}

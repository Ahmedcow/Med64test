export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GROQ_API_KEY is missing from environment.' });
    }

    const { messages, model = 'llama3-8b-8192' } = req.body || {};
    if (!messages) return res.status(400).json({ error: 'Messages parameter is required.' });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, messages })
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Groq Proxy Error:', error);
    return res.status(500).json({ error: 'Failed to communicate with Groq API', details: error.message });
  }
}

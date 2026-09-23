import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);

      const { userId, sessionId, eventType, pagePath, metadata } = body || {};

      if (!userId || !eventType) {
        return res.status(400).json({ error: 'userId and eventType are required.' });
      }

      const ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
      const userAgent = req.headers['user-agent'] || null;

      await sql`
        INSERT INTO user_analytics (user_id, session_id, event_type, page_path, metadata, ip_address, user_agent)
        VALUES (
          ${userId}, 
          ${sessionId || null}, 
          ${eventType}, 
          ${pagePath || '/'}, 
          ${JSON.stringify(metadata || {})}, 
          ${ipAddress}, 
          ${userAgent}
        );
      `;

      return res.status(200).json({ success: true, message: 'Event logged successfully.' });
    }

    if (req.method === 'GET') {
      const { rows } = await sql`SELECT * FROM user_analytics_summary LIMIT 30;`;
      return res.status(200).json({ success: true, metrics: rows });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error('Analytics API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}

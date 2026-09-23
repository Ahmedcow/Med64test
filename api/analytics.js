const { createClient } = require('@supabase/supabase-js');

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in Vercel Environment Variables.');
  return { url, key };
}

async function getUserFromToken(url, serviceKey, token) {
  if (!token) return null;
  const r = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` }
  });
  if (!r.ok) return null;
  try { return await r.json(); } catch (_) { return null; }
}

async function requireAdmin(url, serviceKey, token) {
  const user = await getUserFromToken(url, serviceKey, token);
  if (!user?.id) return null;
  // Call the same is_admin RPC already used by the MedEx client, but preserve
  // the student's JWT so the database function can evaluate that user.
  const r = await fetch(`${url}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: '{}'
  });
  if (!r.ok) return null;
  let data = null;
  try { data = await r.json(); } catch (_) {}
  return data === true ? user : null;
}

module.exports = async function handler(req, res) {
  try {
    const { url, key } = getConfig();
    const adminClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    if (req.method === 'POST') {
      const body = req.body || {};
      const eventType = body.eventType;
      const eventId = String(body.eventId || '').trim();
      const visitorId = String(body.visitorId || '').trim().slice(0, 128);
      if (!['exam_submitted', 'question_answered'].includes(eventType)) {
        res.status(400).json({ error: 'Invalid analytics event type.' });
        return;
      }
      if (!eventId) {
        res.status(400).json({ error: 'Missing analytics event ID.' });
        return;
      }
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const user = await getUserFromToken(url, key, token);
      const { error } = await adminClient.from('exam_analytics_events').insert({
        event_id: eventId,
        event_type: eventType,
        user_id: user?.id || null,
        visitor_id: user?.id ? null : (visitorId || null)
      });
      if (error && error.code !== '23505') throw error; // duplicate retry is harmless
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'GET') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const admin = await requireAdmin(url, key, token);
      if (!admin) {
        res.status(403).json({ error: 'Administrator access required.' });
        return;
      }
      const { count: submittedExams, error: e1 } = await adminClient
        .from('exam_analytics_events').select('event_id', { count: 'exact', head: true }).eq('event_type', 'exam_submitted');
      const { count: answeredQuestions, error: e2 } = await adminClient
        .from('exam_analytics_events').select('event_id', { count: 'exact', head: true }).eq('event_type', 'question_answered');
      if (e1 || e2) throw (e1 || e2);
      res.status(200).json({ submittedExams: submittedExams || 0, answeredQuestions: answeredQuestions || 0 });
      return;
    }

    res.status(405).json({ error: 'Method not allowed.' });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Analytics server error.' });
  }
};

import geminiHandler from './gemini.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }
  const p = req.body || {};
  const count = Math.max(1, Math.min(50, Number(p.count) || 5));
  const source = p.sourceType === 'website'
    ? `Use these website questions only as source material and create new questions without copying them:\n${JSON.stringify(p.sourceQuestions || []).slice(0, 50000)}`
    : 'Use accurate medical knowledge.';
  const prompt = `You are the medical question generator for MedEx. Generate exactly ${count} original multiple-choice questions.
Module: ${p.module || ''}
Subject: ${p.subject || ''}
Lecture: ${p.lecture || ''}
Difficulty: ${p.difficulty || 'Mixed'}
Thinking level: ${p.thinkingLevel || 'Higher-order thinking'}
${source}
Rules: exactly 4 options; exactly one correct answer; clinically accurate; prefer Apply/Analyze/Evaluate clinical reasoning; plausible distractors; no copied source wording; stay focused on the selected lecture; return ONLY a JSON array.
Each item: {"question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"...","difficulty":"..."}`;
  req.body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 8192, responseMimeType: 'application/json' },
    model: p.model
  };
  return geminiHandler(req, res);
}

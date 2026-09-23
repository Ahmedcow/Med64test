const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

function json(res, status, body){
  res.status(status).setHeader('Content-Type','application/json; charset=utf-8');
  return res.end(JSON.stringify(body));
}

function buildQuestionPrompt(p){
  const count=Math.min(Math.max(Number(p.count)||5,1),30);
  const source=p.sourceType==='website'
    ? `Use these website questions as source material. Do not copy them verbatim:\n${JSON.stringify((p.sourceQuestions||[]).slice(0,80))}`
    : 'Use accurate medical knowledge.';
  return `Generate exactly ${count} original medical MCQs for a medical examination website.
Module: ${p.module||'General'}
Subject: ${p.subject||'General'}
Lecture: ${p.lecture||'General'}
Difficulty: ${p.difficulty||'Mixed'}
Thinking level: ${p.thinkingLevel||'Higher-order thinking'}
Source: ${source}
Requirements:
- Exactly 4 options per question.
- Exactly one correct answer.
- Prefer clinical reasoning, application, interpretation, comparison, or multi-step reasoning over simple recall.
- Give a concise but real medical explanation.
- Return ONLY a JSON array. Each object must contain question, options, correctIndex, explanation, difficulty.
- correctIndex must be 0, 1, 2, or 3.`;
}

module.exports = async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed.'});
  const apiKey=process.env.GEMINI_API_KEY;
  if(!apiKey) return json(res,500,{error:'GEMINI_API_KEY is not configured in Vercel Environment Variables.'});
  try{
    const body=req.body||{};
    let contents=body.contents;
    let generationConfig=body.generationConfig||{};
    let model=String(body.model||DEFAULT_MODEL).replace(/^models\//,'').trim()||DEFAULT_MODEL;
    if(!Array.isArray(contents)){
      contents=[{role:'user',parts:[{text:buildQuestionPrompt(body)}]}];
      generationConfig={...generationConfig,responseMimeType:'application/json'};
    }
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const upstream=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify({contents,generationConfig})});
    const raw=await upstream.text();
    let data; try{data=JSON.parse(raw);}catch{data=null;}
    if(!upstream.ok){
      const msg=data?.error?.message||`Gemini API returned HTTP ${upstream.status}.`;
      return json(res,upstream.status,{error:msg,details:data?.error?.status||null});
    }
    const text=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
    if(!text) return json(res,502,{error:'Gemini returned an empty response.',raw:data});
    return json(res,200,{text,model});
  }catch(err){
    return json(res,500,{error:err?.message||'Unexpected Gemini server error.'});
  }
};

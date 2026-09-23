const json = (res, status, body) => {
  res.status(status).setHeader('Content-Type','application/json').end(JSON.stringify(body));
};

function cleanJson(text){
  let t=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  const a=t.indexOf('['), b=t.lastIndexOf(']');
  if(a>=0&&b>a)t=t.slice(a,b+1);
  return JSON.parse(t);
}
function extractGemini(data){
  return data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
}
async function fetchWithTimeout(url, opts={}, ms=45000){
  const c=new AbortController(); const id=setTimeout(()=>c.abort(),ms);
  try{return await fetch(url,{...opts,signal:c.signal});}finally{clearTimeout(id);}
}
async function groq(prompt){
  const key=process.env.GROQ_API_KEY;if(!key)throw new Error('Groq key not configured');
  const model=process.env.GROQ_MODEL||'llama-3.3-70b-versatile';
  const r=await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'system',content:'You are a medical education question-writing agent. Return ONLY a JSON array.'},{role:'user',content:prompt}],temperature:.7,max_tokens:7000})});
  const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||`Groq HTTP ${r.status}`);return d?.choices?.[0]?.message?.content||'';
}
async function openrouter(prompt){
  const key=process.env.OPENROUTER_API_KEY;if(!key)throw new Error('OpenRouter key not configured');
  const model=process.env.OPENROUTER_MODEL||'meta-llama/llama-3.3-70b-instruct:free';
  const r=await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:'https://medex.app','X-Title':'MedEx'},body:JSON.stringify({model,messages:[{role:'system',content:'You are an independent medical question-writing agent. Return ONLY a JSON array.'},{role:'user',content:prompt}],temperature:.65,max_tokens:7000})});
  const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||`OpenRouter HTTP ${r.status}`);return d?.choices?.[0]?.message?.content||'';
}
async function gemini(prompt){
  const key=process.env.GEMINI_API_KEY;if(!key)throw new Error('Gemini key not configured');
  const model=process.env.GEMINI_MODEL||'gemini-2.5-flash';
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const r=await fetchWithTimeout(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:.65,maxOutputTokens:7000,responseMimeType:'application/json'}})});
  const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||`Gemini HTTP ${r.status}`);return extractGemini(d);
}
function basePrompt(p,n,role){
 return `You are Agent ${role} in a multi-agent medical exam pipeline. Generate exactly ${n} ORIGINAL MCQs for medical students.\nModule: ${p.module}\nSubject: ${p.subject}\nLecture: ${p.lecture}\nDifficulty: ${p.difficulty}\nThinking level: ${p.thinkingLevel}\n\n${p.sourceType==='website'?'Use the website questions below only as topic/content reference. Never copy their wording or answer pattern.\n'+JSON.stringify(p.sourceQuestions||[]):'Use established medical knowledge. Do not invent facts or sources.'}\n\nRequirements:\n- Exactly 4 options and exactly one correct option.\n- correctIndex is zero-based.\n- Prefer clinical vignettes, interpretation, mechanisms, comparisons, and best-next-step reasoning.\n- Distractors must be plausible and medically meaningful.\n- Include a concise explanation that justifies the correct answer.\n- Avoid duplicates within your output.\n- Return ONLY a JSON array of objects with: question, options, correctIndex, explanation, difficulty.`;
}
async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  try{
    const p=req.body||{}; const count=Math.max(1,Math.min(50,Number(p.count)||5));
    if(!p.module||!p.subject||!p.lecture)return json(res,400,{error:'Module, subject and lecture are required.'});
    const agents=[];
    const n=Math.ceil(count/3);
    const jobs=[['Groq',groq],['Gemini',gemini],['OpenRouter',openrouter]];
    const results=await Promise.allSettled(jobs.map(([name,fn],i)=>fn(basePrompt(p,Math.min(n,count-i*n),name))));
    const drafts=[]; const used=[];
    results.forEach((r,i)=>{if(r.status==='fulfilled'){try{const arr=cleanJson(r.value);if(Array.isArray(arr))drafts.push(...arr);}catch(e){used.push(`${jobs[i][0]} parse failed`);}}else used.push(`${jobs[i][0]} unavailable`);});
    if(!drafts.length)return json(res,502,{error:'All AI agents failed. Configure at least one of GROQ_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY and try again.'});

    // Local structural validation + duplicate filtering before the critic.
    const accepted=[]; const seen=new Set();
    for(const q of drafts){
      const text=String(q?.question||'').trim().toLowerCase().replace(/\s+/g,' ');
      if(!text||seen.has(text)||!Array.isArray(q.options)||q.options.length!==4||!Number.isInteger(q.correctIndex)||q.correctIndex<0||q.correctIndex>3)continue;
      if(q.options.some(x=>!String(x||'').trim())||!String(q.explanation||'').trim())continue;
      seen.add(text);accepted.push({...q,difficulty:q.difficulty||p.difficulty});
      if(accepted.length>=count*2)break;
    }
    if(!accepted.length)return json(res,502,{error:'Agents returned no valid questions. Try a smaller batch or different lecture.'});

    // Final critic/synthesizer: prefer Gemini, then Groq, then OpenRouter.
    const finalPrompt=`You are the final senior medical QA editor. From the candidate questions below, select and lightly repair the best ${count} questions.\nRules: preserve the selected topic and difficulty; remove duplicates; correct medical inaccuracies; ensure exactly 4 options and exactly one correctIndex; explanations must justify the answer; do not add unsupported citations. Return ONLY a JSON array.\nCandidates:\n${JSON.stringify(accepted)}`;
    let finalText='',critic='';
    const critics=[['Gemini',gemini],['Groq',groq],['OpenRouter',openrouter]];
    for(const [name,fn] of critics){try{finalText=await fn(finalPrompt);critic=name;break;}catch(e){used.push(`${name} critic unavailable`);}}
    let finalList=[];
    if(finalText){try{finalList=cleanJson(finalText).filter(Boolean).slice(0,count);}catch(e){finalList=[];}}
    if(finalList.length<count) finalList=accepted.slice(0,count);
    return json(res,200,{text:JSON.stringify(finalList),agents:`${jobs.filter((_,i)=>results[i].status==='fulfilled').map(x=>x[0]).join(' + ')||'local'}${critic?' + '+critic+' critic':''}`,warnings:used});
  }catch(e){return json(res,500,{error:e?.message||'Multi-agent generation failed.'});}
}
module.exports=handler;

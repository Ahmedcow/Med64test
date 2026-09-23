async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    const key=process.env.GEMINI_API_KEY;if(!key)throw new Error('GEMINI_API_KEY is not configured in Vercel.');
    const model=req.body?.model||process.env.GEMINI_MODEL||'gemini-2.5-flash';
    const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:req.body?.contents||[],generationConfig:req.body?.generationConfig||{}})});
    const d=await r.json();if(!r.ok)return res.status(r.status).json({error:d?.error?.message||`Gemini HTTP ${r.status}`});
    const text=d?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
    if(!text)return res.status(502).json({error:'Gemini returned an empty response.'});
    return res.status(200).json({text});
  }catch(e){return res.status(500).json({error:e?.message||'Gemini request failed.'});}
}
module.exports=handler;

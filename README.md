# MedEx — Multi-Provider AI version

This version lets MedEx users switch the AI provider and model from the AI Assistant page.

## Supported providers

### Groq
- `openai/gpt-oss-120b` — high-reasoning, fast generation
- `qwen/qwen3.8-27b` — structured-output option

Environment variable:
- `GROQ_API_KEY`

### Google Gemini
- `gemini-2.5-pro` — deep reasoning/science
- `gemini-2.5-flash` — fast high-volume generation
- `gemini-2.5-flash-lite` — lower-cost high-volume generation

Environment variable:
- `GEMINI_API_KEY`

### Vercel AI Gateway
- `openai/gpt-5.4` — advanced reasoning
- `anthropic/claude-opus-4.5` — difficult reasoning
- `google/gemini-2.5-pro` — science/reasoning
- `openai/gpt-5.5` — current Vercel catalog option

Environment variable:
- `AI_GATEWAY_API_KEY`

Vercel deployments can also authenticate the Gateway with `VERCEL_OIDC_TOKEN`; the server route supports that fallback.

## Vercel Environment Variables

In Vercel: Project → Settings → Environment Variables, add the credentials you want to enable. You do not need all three if you only want one or two providers.

- `GROQ_API_KEY` = Groq API key
- `GEMINI_API_KEY` = Google AI Studio/Gemini API key
- `AI_GATEWAY_API_KEY` = Vercel AI Gateway API key

Enable each variable for Production (and Preview/Development if you want those environments to use it). Never put these keys in `index.html` or GitHub.

## How the switch works

Users open AI Assistant → choose `Groq`, `Google Gemini`, or `Vercel AI Gateway` → choose a model → save. The browser sends only the selected provider/model to `/api/ai`; the provider credentials remain server-side.

## Large MCQ generation

The generator now allows up to 100 questions per request in the UI. Provider token/rate limits still apply, so for very large banks use repeated batches rather than one enormous request.

## Files

- `index.html` — MedEx app and provider/model selector
- `api/ai.js` — secure multi-provider Vercel serverless proxy
- `api/groq.js` — legacy Groq-only route retained for compatibility

# MedEx — Groq AI version

This version changes the AI provider from Gemini to Groq.

## Vercel setup

Add this Environment Variable in the Vercel project:

- Name: `GROQ_API_KEY`
- Value: your Groq API key
- Environments: Production, Preview, and Development

Then redeploy the project.

The key is read only by `/api/groq.js` on the Vercel server. It is NOT placed in `index.html`.

## Default model

The website defaults to:

`openai/gpt-oss-120b`

Groq documents an OpenAI-compatible API at `https://api.groq.com/openai/v1`, and the model can be changed later if desired.

## Files

- `index.html` — MedEx frontend
- `api/groq.js` — secure Vercel serverless proxy for Groq

Keep the `api` folder at the project root beside `index.html`.

## Important

Do not paste your Groq API key into GitHub or into `index.html`.

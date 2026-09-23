MedEx AI + Analytics setup

1. Supabase SQL
   - Open Supabase -> SQL Editor.
   - Paste analytics.sql and run it.

2. Vercel Environment Variables
   Add these variables to the project (Production, Preview if desired):
   GEMINI_API_KEY = your Gemini API key
   GEMINI_MODEL = gemini-2.5-flash   (optional; the server can fall back to an available Flash model)
   SUPABASE_URL = https://ywveooexkhmmmxwtmxxl.supabase.co
   SUPABASE_SERVICE_ROLE_KEY = your Supabase service-role key

   IMPORTANT: SUPABASE_SERVICE_ROLE_KEY must ONLY be a Vercel/server environment variable.
   Never put it inside index.html.

3. Redeploy Vercel after adding the variables.

4. AI Assistant
   - Ask AI uses /api/gemini.
   - Question generation also uses /api/gemini, so it no longer depends on /api/multi-agent.
   - The browser does not receive the Gemini API key.

5. Admin Analytics
   - Sign in with the same administrator account used for the existing Admin pages.
   - The Analytics item appears only for admins.
   - It displays only:
       * Submitted exams
       * Answered questions
   - Counts include signed-in and non-signed-in users.
   - Duplicate retries use the event ID and are ignored.

6. Anonymous analytics
   - A random browser visitor ID is generated locally only to distinguish anonymous events.
   - No email, question text, answer text, or exam score is stored by this analytics feature.

# Chatbot API

Express/TypeScript API for a registration chatbot that collects user details, calls OpenAI for responses, and stores submissions in Supabase Postgres.

## Requirements
- Node.js 18+
- npm
- Supabase project (Postgres)
- OpenAI API key

## Environment
Create a `.env` in the project root:
```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
PORT=3000
```

## Run the backend locally
- Install deps: `npm install`
- Dev server with reload: `npm run dev`
- Production build: `npm run build && npm start`
- Server listens on `http://localhost:${PORT:-3000}`.

## Database
- Platform: Supabase (managed Postgres).
- Table: `public.registrations` with columns `id uuid primary key`, `user_id text`, `name text`, `date_of_birth date`, `gender text`, `uses_budget_app boolean`, `budget_app_name text`, `completed boolean`, `created_at timestamptz`.
- The API writes completed registrations via `supabase.from("registrations").insert(...)` in `messageRoute.ts`.

## LLM usage
- Provider: OpenAI.
- File: `openaiClient.ts`.
- Endpoint: `chat.completions` with model from `OPENAI_MODEL` (defaults to `gpt-4o-mini`).
- `/llm-echo` route demonstrates a simple prompt/response pass-through.

## Frontend
- No frontend lives in this repo. If you have a separate frontend, point it at the backend base URL (`/message` for the registration flow, `/llm-echo` for echo testing) after setting the same environment variables locally.

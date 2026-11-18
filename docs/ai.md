# AI (Phase 4)

AI helps people decide. It never decides for them: no AI result moves, rejects,
hires or messages a candidate by itself.

## Pipeline

Every model call goes through one function, `runAIFeature(ctx, featureKey, vars)`
in `lib/ai/run.ts`:

1. check the feature is on for the portal and the caller has `ai.use`
2. per-user token-bucket rate limit (Redis Lua, or in-memory without Redis)
3. monthly credit check (platform key only; a portal's own key is not charged)
4. load the newest active prompt version (`PromptTemplate`, seeded from code)
5. call the provider, validate the reply with zod, retry once with the problem spelled out
6. write `AIUsage` (tokens, latency, credits, status) and a redacted `AIRequestLog`
   (kept for the portal's retention period, purged by the worker tick)

Providers (`lib/ai/providers`): OpenAI, Anthropic, Gemini, OpenAI-compatible, and a
deterministic `fake` for tests and local development. Structured output is
provider-agnostic: the JSON schema goes in the prompt and the reply is validated.
Failures reach the user as a generic message; vendor details stay in `AIUsage.error`.

## Keys and governance

- Platform keys come from environment variables. A portal may add its own key
  (`PUT /api/teams/:slug/ai/settings`, permission `ai.configure`).
- Portal keys are encrypted with AES-256-GCM and are write-only: the API returns only a hint.
- Custom base URLs must be public `https` hosts (SSRF guard).
- Feature switches, log retention, usage by feature and a redacted request log are on `/teams/:slug/ai`.

## Fairness, in code

- The model sees anonymised, scrubbed text only: no name, contact data, institution,
  photo, age, gender, religion, marital status; gendered pronouns are neutralised.
- The score is computed in code (skills, depth, years from explicit dates, location,
  education, certifications). The model supplies only the depth sub-score,
  an explanation and suggested questions.
- Evidence quotes must appear in the source text or they are dropped.
- Total experience comes from dates; a number written by the model is ignored.
- Search never uses protected attributes as filters or ranking signals.

## Features

| Feature                   | Where                                 | Notes                                                                                                                            |
| ------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Resume parsing            | candidate upload, worker job          | confident fields applied, uncertain ones wait for the candidate; original file kept                                              |
| Job description generator | job form                              | draft for the author to edit; output HTML is sanitised                                                                           |
| Match assessment          | application page, "match all" per job | history kept; never changes a stage                                                                                              |
| Talent search             | Talent page                           | natural language to removable filter chips; full-text + vector + filters fused with RRF; works without embeddings                |
| Recommendations           | candidate dashboard                   | per-portal opt-in; latest consent decision wins; deterministic "why"                                                             |
| Copilot                   | `/teams/:slug/copilot`                | tools run with the caller's permissions; candidates are handles (C1, C2) so names never reach the model; step limit; drafts only |
| Interview assistant       | interview page                        | questions from the candidate's gaps; feedback summary with anonymised interviewers and verified quotes                           |
| Message drafts            | application page                      | creates a DRAFT; a person approves and sends                                                                                     |

## Queue

`lib/queue.ts` uses BullMQ when `REDIS_URL` is set (`npm run worker`) and runs jobs
inline otherwise. "AI not configured" is a skip, not a failure.

## Database

pgvector is required (`vector(1536)`, HNSW indexes on `CandidateProfile` and `Job`);
use the `pgvector/pgvector` image (see `docker-compose.yml`). `CandidateProfile.search`
is a generated `tsvector` column for full-text search.

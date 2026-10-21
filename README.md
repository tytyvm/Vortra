# Vortra

Vortra is a personal AI nutrition coach and trainer that people chat with like a real assistant, by text or photo. It sets up goals and targets, estimates and logs food, keeps running daily totals, logs workouts set by set, tracks weigh-ins, builds training plans, answers questions from the user's real history, and can send daily and weekly recaps.

The app stays simple on purpose. **The coaching intelligence lives in the AI model and one plain-English instruction file, [`prompts/coach.md`](prompts/coach.md).** App code only does three things: it gives the model context, runs the tools the model calls (and validates their arguments), and computes the numbers (totals, 7-day lines, averages). The app has no message classifiers, no regex parsers and no template replies, and it never rewrites the model's answers.

---

## Quick start (mock mode, no API keys)

Requirements: Node.js 20.19+ (22 recommended).

```bash
npm install
npm run mock
```

Open http://localhost:3000, enter any email, and click the sign-in link shown on the page (it's also printed in the terminal). The **mock provider** returns realistic tool calls and replies without any network access, so the whole app works offline: logging, the Today panel, History edits and deletes, Settings, and export.

`npm run mock` uses SQLite at `prisma/dev.db`, the mock AI provider and console email. It runs `prisma generate` and `prisma db push`, then starts the dev server.

## Using a real model

1. `cp .env.example .env`
2. Set the provider, the model and that provider's key:

```bash
LLM_PROVIDER=openai          # mock | openai | anthropic | gemini | xai | openai-compatible
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...
```

3. `npm run dev`. If the database doesn't exist yet, run `npx prisma db push` first.

Switching models only changes environment variables. You never edit code. Examples:

| Provider | `LLM_PROVIDER` | Example `LLM_MODEL` | Key / URL variables |
|---|---|---|---|
| OpenAI | `openai` | `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-5-mini` | `OPENAI_API_KEY` |
| Anthropic | `anthropic` | `claude-haiku-4-5`, `claude-sonnet-4-5` | `ANTHROPIC_API_KEY` |
| Google Gemini | `gemini` | `gemini-2.5-flash` | `GEMINI_API_KEY` (optional `GEMINI_THINKING_BUDGET`) |
| xAI | `xai` | `grok-4-fast` | `XAI_API_KEY` |
| OpenRouter | `openai-compatible` | `anthropic/claude-haiku-4.5` | `OPENAI_COMPATIBLE_BASE_URL=https://openrouter.ai/api/v1`, `OPENAI_COMPATIBLE_API_KEY` |
| Groq | `openai-compatible` | `llama-3.3-70b-versatile` | `OPENAI_COMPATIBLE_BASE_URL=https://api.groq.com/openai/v1` |
| Together | `openai-compatible` | any chat model with tool support | `OPENAI_COMPATIBLE_BASE_URL=https://api.together.xyz/v1` |
| Mistral | `openai-compatible` | `mistral-small-latest` | `OPENAI_COMPATIBLE_BASE_URL=https://api.mistral.ai/v1` |
| DeepSeek | `openai-compatible` | `deepseek-chat` | `OPENAI_COMPATIBLE_BASE_URL=https://api.deepseek.com/v1` |
| Ollama (local) | `openai-compatible` | `qwen2.5:7b` | `OPENAI_COMPATIBLE_BASE_URL=http://localhost:11434/v1` (no key) |

Model names change often, so check your provider's model list. The model you pick must support **tool or function calling**.

**Optional extra models**

- `LLM_RECAP_PROVIDER` and `LLM_RECAP_MODEL`: a cheaper model for daily and weekly recaps.
- `LLM_PHOTO_PROVIDER` and `LLM_PHOTO_MODEL`: a vision model used only for messages that include a photo.
- `LLM_VISION=false`: set this when the main model can't read images. If you also leave the photo model unset, a user who sends a photo is asked to describe the meal instead.

If your OpenAI-compatible server rejects `stream_options`, set `OPENAI_COMPATIBLE_STREAM_USAGE=false`. Token usage is then estimated.

## Editing the coach

Edit [`prompts/coach.md`](prompts/coach.md) to change how Vortra coaches: setup questions, target formulas, reply length, tone and safety rules. The file is re-read on every message, so changes apply immediately without a restart. Recap wording lives in [`prompts/recap.md`](prompts/recap.md).

## How a message is handled

Each user message makes one AI call, plus extra round trips when the model calls tools (capped by `MAX_TOOL_ROUNDS`; the last round has tools turned off so the model has to reply). The model receives:

1. The coach instructions (`prompts/coach.md`), marked cacheable where the provider supports it.
2. The user's profile JSON (stats, goals, targets, preferences, injuries) and current training plan.
3. Today's totals vs targets and today's entries, with ids so the model can edit them. Code computes these from the logs.
4. One line per day for the last 7 days (calories and macros, workout, weight).
5. A running summary of older conversation (at most ~150 words), which the model writes with `update_summary`.
6. The last `HISTORY_MESSAGES` messages verbatim, trimmed oldest first to fit `MAX_INPUT_TOKENS`, followed by the new message and photo. Photos from past turns are never re-sent.

The model's tools are `log_meal`, `log_exercise`, `log_weight`, `edit_entry`, `delete_entry`, `get_logs`, `update_profile`, `save_plan` and `update_summary`. Every call is validated with zod before anything is written. Invalid arguments go back to the model as an error so it can fix them. Tool results contain numbers computed by code, such as running totals, what's left vs targets, the change since the last weigh-in, the 7-day average and the previous session of an exercise. That way the model reports accurate figures.

## Environment variables

All settings are documented in [`.env.example`](.env.example). The main ones:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `file:./prisma/dev.db` | SQLite file for dev, or `postgresql://...` for production |
| `APP_URL` | `http://localhost:3000` | Public URL, used in sign-in links and redirects |
| `LLM_PROVIDER`, `LLM_MODEL` | `mock` | Main chat model |
| `MAX_OUTPUT_TOKENS` | 700 | Maximum tokens per reply |
| `MAX_INPUT_TOKENS` | 12000 | Input context budget; the oldest history is trimmed first |
| `HISTORY_MESSAGES` | 10 | Recent messages sent verbatim |
| `MAX_TOOL_ROUNDS` | 6 | Maximum model calls per user message |
| `USER_MONTHLY_LIMIT_USD` | 5 | Estimated AI spend per user per calendar month (UTC) |
| `APP_DAILY_LIMIT_USD` | 25 | Estimated AI spend across the whole app per day (UTC) |
| `CHAT_RATE_LIMIT_PER_MIN` | 12 | Chat messages per user per minute |
| `RECAPS_ENABLED` | false | Turns on daily and weekly recaps for the deployment |
| `EMAIL_PROVIDER` | console | `console` (dev only), `resend` or `postmark` |
| `STRIPE_ENABLED` | false | Optional subscriptions |

### Cost controls

- Every model call writes a row to the `Usage` table with input and output tokens and an **estimated** cost from [`config/prices.json`](config/prices.json). Lookup uses the exact model id first, then the longest matching prefix, then `default`. **Prices change, so check your provider's pricing page and edit that file.** Unknown models fall back to a deliberately high default price so the ceilings stay on the safe side.
- Before each call the app checks the user's monthly ceiling and the app-wide daily ceiling. When either is hit, the user gets a friendly message and no call is made.
- There are no automatic retries. The only background loop is the optional recap scheduler.
- Users can see their month's estimated usage in Settings.

### Recaps

Set `RECAPS_ENABLED=true`. Each opted-in user who has been active in the last 7 days gets a short recap in their chat once a day after `RECAP_HOUR` (default 20:00) in their own time zone. On Sundays they get a weekly recap instead. Users can turn each recap off in Settings. Recaps can also be emailed with `RECAPS_EMAIL=true`.

There are two ways to run the schedule:

- `RECAPS_SCHEDULER=external` (recommended): have your platform's cron call the app hourly.
  ```bash
  curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron/recaps
  ```
- `RECAPS_SCHEDULER=internal`: the running app checks every 15 minutes. Use this only with a single instance.

### Subscriptions (optional)

Billing is off by default and Stripe is never called while `STRIPE_ENABLED=false`. To turn it on, set `STRIPE_ENABLED=true`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` (a recurring price) and `STRIPE_WEBHOOK_SECRET`, then point a Stripe webhook at `/api/billing/webhook` for these events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. Plan limits come from `PLAN_FREE_MONTHLY_USD`, `PLAN_PRO_MONTHLY_USD` and `PLAN_FREE_PHOTOS`. Settings shows Upgrade (Stripe Checkout) and Manage subscription (Customer Portal).

## Accounts, privacy and security

- **Sign-in:** email magic links valid for 15 minutes and usable once. Tokens and sessions are stored only as SHA-256 hashes. The session cookie is `HttpOnly` and `SameSite=Lax`, and it's `Secure` in production. Mutating requests are checked against the request origin. Sign-in requests are rate limited.
- **Isolation:** every query is scoped to the signed-in user, and tool calls can't touch another user's entries (this is tested).
- **Logs:** app logs contain only event names, ids, counts and status codes. They never include message text, food, weights or profile data. Prisma query logging is off. Provider error bodies are reduced to an error type, because they can echo user content.
- **Photos** are resized in the browser to at most 1024 px and sent to the model. They aren't stored.
- **Your data:** Settings → Export (all data as JSON, or CSV per table) and Delete account. Deletion cascades to all of the user's data. Usage rows are kept without the user id, so the app-wide spend stays accurate.
- **Secrets** live only in environment variables. `.env` is git-ignored.
- The chat endpoint is rate limited per user. The limiter is in memory, which is fine for one instance. If you run several, put a shared limiter in front.

## Tests

```bash
npm test
```

All tests run offline against a fresh SQLite test database, using the mock provider and recorded sample responses. They make no live calls. They cover:

- tool calls writing the correct rows, rejecting invalid arguments and keeping users isolated
- today's totals and the 7-day lines (including time zones)
- edits and deletes re-totaling
- context trimming and what the model receives
- spend ceilings and usage recording
- provider adapters translating tools, images and tool results, and parsing streamed responses for OpenAI-style, Anthropic and Gemini APIs
- recap scheduling
- magic-link sessions, account deletion, rate limiting, webhook signatures and safe markdown

## Manual live test (spends real money)

```bash
npm run live-test -- --confirm
```

This sends 10 scripted messages (setup, meals, a correction, a weigh-in, a workout, a question and a plan) to the model configured in `.env`. It prints the replies, the tool calls, token usage per turn and the total estimated cost. It uses a temporary user that is deleted afterwards. It refuses to run without `--confirm`, and it refuses to run in CI or tests.

## Deploying

The app is a single service: one Next.js server plus Postgres.

**Railway**

The repo includes `railway.json`, so Railway builds it with the Dockerfile and health-checks `/api/health`.

1. In Railway, choose New Project → Deploy from GitHub repo, and pick this repo.
2. In the same project, choose + New → Database → PostgreSQL.
3. Open the app service and go to Settings → Networking → Generate Domain. Copy the URL.
4. In the app service, open Variables and add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `APP_URL` = the domain from step 3, starting with `https://`
   - `LLM_PROVIDER`, `LLM_MODEL` and that provider's key. You can use `LLM_PROVIDER=mock` for a first test.
   - `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and `EMAIL_FROM`. Without a verified domain, Resend only delivers to the email you signed up to Resend with, from `onboarding@resend.dev`.
   - Optionally `USER_MONTHLY_LIMIT_USD` and `APP_DAILY_LIMIT_USD`.
5. Redeploy. When the app starts, it creates the tables with `prisma db push`.

**Docker**

```bash
docker build -t vortra .
docker run -p 3000:3000 --env-file .env vortra
```

The Dockerfile switches the Prisma schema to Postgres, generates the client and builds the app. On start it runs `prisma db push` and then `next start`. Set at least `DATABASE_URL=postgresql://...`, `APP_URL`, your LLM variables, and `EMAIL_PROVIDER=resend` or `postmark` with its key. Console email refuses to run in production.

**Any Node host** (Railway, Render, Fly.io, a VPS):

1. Provision Postgres and set the environment variables.
2. Change `provider = "sqlite"` to `provider = "postgresql"` in `prisma/schema.prisma`, or build with the Dockerfile.
3. Build with `npm ci && npm run build`, then start with `npx prisma db push && npm start`.
4. Optionally add an hourly cron for `/api/cron/recaps`.

`prisma db push` is the simplest choice for a small app, and it refuses changes that would lose data. If you need stricter change control, switch to `prisma migrate`.

> Note: Vortra uses **Prisma 7** with driver adapters: `better-sqlite3` for SQLite and `pg` for Postgres. That means the running app needs no native Prisma query engine. The Prisma CLI (`generate` and `db push`) downloads its schema engine on first use.

## Project layout

```
prompts/coach.md          coach instructions (edit freely)
prompts/recap.md          recap instructions
config/prices.json        per-model prices for cost estimates
prisma/schema.prisma      data model
src/lib/llm/              provider layer: types, openai (also xAI and compatible servers), anthropic, gemini, mock
src/lib/coach/            agent loop, context builder, tools, logs, totals, spend ceilings, recaps
src/lib/                  config, auth, email, billing, rate limiting, markdown, time zones
src/app/                  pages (chat, history, settings) and API routes
src/components/           chat UI, Today panel, History, Settings, login
tests/                    offline test suite and recorded provider samples
scripts/mock.mjs          one-command mock mode
scripts/live-test.ts      manual live test (--confirm required)
```

Vortra gives estimates, not medical advice. The owner of a deployment is responsible for their own terms, privacy policy and any health-data regulations that apply to them.

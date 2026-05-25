@AGENTS.md
<!-- Add anything Claude Code specific that other agents don't need -->
# CLAUDE.md — Job Application Pipeline Project

## What This Is
career-ops has been adapted into a cheap, self-hosted, autonomous job application
pipeline. The original repo used Claude Code + Anthropic API (~$200/month). This
version replaces that with a provider-agnostic OpenAI-compatible LLM backend
(currently OpenRouter), running on a $6/month DigitalOcean Droplet, interfaced
entirely through Discord.

## Golden Rule
The user (Dan) interacts ONLY through Discord. Nothing runs on his local machine
except Obsidian (read-only, synced via Syncthing) and Discord. All compute happens
on the Droplet.

## Stack
- **Hosting:** DigitalOcean Droplet, NYC3, Ubuntu 24.04, $6/month
- **Runtime:** Docker Compose, restart policy: unless-stopped
- **LLM:** Provider-agnostic via OpenAI-compatible API. Switching providers is a
  `.env` change, not a code change. Active provider configured via `LLM_PROVIDER`,
  `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` in `.env`.
- **Current provider:** OpenRouter (`https://openrouter.ai/api/v1`).
  - Reason: Groq Dev Tier was unavailable due to high demand at switch time.
  - OpenRouter routes to whichever underlying provider is cheapest, ~$0.40-0.80/M
    tokens for Llama 3.3 70B. Per-eval cost ~$0.008-$0.013.
- **Model routing:**
  - Heavy tasks (evaluation, scoring, cover letters): `meta-llama/llama-3.3-70b-instruct`
  - Light tasks (form filling, parsing, logging, status updates): swap in
    `meta-llama/llama-3.1-8b-instruct` or `gpt-4o-mini` via `LLM_MODEL` or `--model` flag
- **Fallback providers** (preset blocks in `.env.example`):
  - Groq — free tier 12k TPM (limited but free)
  - DeepInfra — cheapest direct provider for Llama 3.3 70B
  - OpenAI — gpt-4o-mini, very cheap and reliable
- **Interface:** Discord bot (private server)
- **Tracking:** Obsidian vault (markdown notes, synced Droplet → machines via Syncthing)
- **Browser automation:** Playwright (already in career-ops)
- **No local GPU usage** — Dan has a 2080Ti (11GB VRAM), insufficient for 32B+ models

## Droplet Details
- IP: 147.182.136.203
- User: jobops
- Repo location: /home/jobops/career-ops
- Docker Compose will be the process manager

## Discord Channel Structure
- #job-alerts — new job matches posted here, Dan reacts ✅/❌
- #needs-input — custom application questions Dan must answer in thread
- #pipeline-status — daily digest, on-demand summaries, follow-up reminders
- #bot-logs — raw activity log

## Dan's Job Search Profile
- **Target roles:** ML Engineer, MLOps Engineer, NLP Engineer, Computer Vision
  Engineer, Edge AI, Data Scientist
- **Location:** NJ-based or remote
- **Background:**
  - PNC Bank — built org's first ML production pipeline (overdraft predictor,
    loan rate optimizer, document classifier, internal chatbot)
  - Four Growers — computer vision for automated tomato harvesting (agricultural
    robotics startup)
  - Army National Guard — Sergeant, 2015-2021
- **Archetypes** (added to `modes/_profile.md` per AGENTS.md user-layer rule —
  NOT _shared.md, which is system-layer and may be overwritten by upstream updates):
  - MLOps Engineer — maps to PNC platform work
  - NLP Engineer — PNC document extraction + RAG chatbot
  - Computer Vision Engineer — Four Growers Mask R-CNN + YOLO
  - Generative AI / LLM Engineer — PNC RAG, GANs/VAEs/Latent Diffusion stack
  - Edge AI / Robotics ML — Four Growers robotics + Guard adjacency
  - Data Scientist — PNC XGBoost loan optimizer + analytical work
  - Research Engineer — LLNL + CMU CNBC background
  - Applied ML Engineer (generalist) — catch-all for end-to-end ML roles

## Key Decisions Already Made
- LLM backend made provider-agnostic via .env config (OpenRouter primary, Groq fallback)
- Groq Dev Tier waitlist-blocked → switched to OpenRouter pay-as-you-go
- PDF generation punted until Phase 3 (LLM returns text not files)
- scan.mjs already works standalone (no rewrite needed); pipeline processor
  for evaluating discovered URLs deferred to Phase 5 (Discord layer)
- Obsidian chosen over Notion (free, local-first, markdown, no API needed)
- Syncthing chosen over Obsidian Sync (free)
- gemini-eval.mjs pattern used as template for llm-eval.mjs (correct approach)

## What Already Exists in This Repo

### Code (Phase 2 — LLM swap)
- **llm-eval.mjs** — Provider-agnostic evaluator. Reads `LLM_*` env vars and routes
  to any OpenAI-compatible API. Supports interactive and batch modes. Has presets
  for OpenRouter, Groq, DeepInfra, OpenAI.
  - Back-compat: falls back to `OPENROUTER_API_KEY` → `GROQ_API_KEY` with appropriate
    base URL defaults if `LLM_API_KEY` not set.
- **batch/batch-runner.sh** — Updated to call `node llm-eval.mjs` instead of
  `claude -p`. Provider-agnostic, picks up `LLM_*` config from .env.
- **package.json** — `openai` SDK dependency, `llm:eval` script.
- **.env.example** — Provider preset blocks for OpenRouter / Groq / DeepInfra / OpenAI.

### Personalization (Phase 4 — Dan's profile)
- **cv.md** — Dan's resume in clean markdown (Summary, 4 work entries, Service,
  Education, Skills). Read by `llm-eval.mjs` on every eval.
- **config/profile.yml** — Dan's target roles, archetype list, comp targets
  ($120K base floor), location prefs (Remote > NYC > Pittsburgh), dealbreakers
  (off-list locations, clearance roles, sub-floor comp), work auth (US citizen,
  no clearance, Guard veteran), 7yr experience signaling.
- **modes/_profile.md** — Dan's 8 ML archetypes (MLOps, NLP, CV, Generative AI,
  Edge AI, Data Scientist, Research Engineer, Applied ML generalist), adaptive
  framing table mapping each archetype to which PNC/Four Growers/research proof
  points to emphasize, cross-cutting advantage narrative, location-policy
  scoring rules, negotiation scripts adapted to Dan's situation.

## What Still Needs To Be Built
See CHECKLIST.md for full status. Summary:
- **Pipeline processor** (NOT scan.mjs — that already works standalone).
  Needed for autonomous flow: takes URLs from data/pipeline.md → fetches
  JD text (Playwright or per-ATS JD-content APIs) → invokes llm-eval.mjs.
  Will be built as part of Phase 5 (Discord) since the Discord bot is the
  natural caller of this logic.
- Docker Compose setup (Phase 3)
- Discord bot integration with webhook + reaction handling (Phase 5)
- Obsidian note writer + Syncthing setup (Phase 6)
- Cron scheduling (Phase 7)

## File Structure Notes
- modes/ — skill mode instructions, written for Claude Code, work as plain prompts
- modes/_shared.md — add ML archetypes here
- config/profile.yml — Dan's job search preferences (copy from profile.example.yml)
- portals.yml — job board targets (copy from templates/portals.example.yml)
- cv.md — Dan's resume in markdown (must be created)
- .env — credentials, never committed, exists on Droplet and locally
- data/ — tracking TSV files (gitignored)
- reports/ — eval reports (gitignored)
- output/ — generated PDFs (gitignored)

## Environment Variables (in .env)
```
# Active LLM provider config
LLM_PROVIDER=openrouter
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=<openrouter-key>
LLM_MODEL=meta-llama/llama-3.3-70b-instruct
LLM_MAX_TOKENS=4096

# Provider-specific keys (kept for easy switching)
OPENROUTER_API_KEY=<openrouter-key>
GROQ_API_KEY=<groq-key>

# Discord + Droplet
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_ALERTS_CHANNEL_ID=
DISCORD_INPUT_CHANNEL_ID=
DISCORD_STATUS_CHANNEL_ID=
DISCORD_LOGS_CHANNEL_ID=
DROPLET_IP=147.182.136.203
```

To switch providers, edit `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`. See
`.env.example` for preset blocks (OpenRouter, Groq, DeepInfra, OpenAI).

## How To Deploy Changes
1. Make changes locally
2. git add, commit, push
3. SSH to Droplet: ssh jobops@147.182.136.203
4. cd career-ops && git pull
5. npm install (if package.json changed)
6. docker compose restart (if containers running)

## Important Constraints
- Never hardcode credentials — always read from .env
- Never run LLM inference locally
- Never submit an application without Dan's explicit Discord approval
- Rate limit LLM calls during scan runs to avoid bursting provider quotas
- All file writes go to mounted Docker volumes, not container internals

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
- **Archetypes to add to modes/_shared.md:**
  - LLMOps — production LLM pipeline roles
  - MLOps — maps to PNC background
  - NLP Engineer — document classification, extraction
  - Computer Vision — Four Growers background
  - Edge AI — defense/robotics adjacent

## Key Decisions Already Made
- LLM backend made provider-agnostic via .env config (OpenRouter primary, Groq fallback)
- Groq Dev Tier waitlist-blocked → switched to OpenRouter pay-as-you-go
- PDF generation punted until Phase 3 (LLM returns text not files)
- WebSearch/Playwright browsing deferred for scan.mjs rewrite
- Obsidian chosen over Notion (free, local-first, markdown, no API needed)
- Syncthing chosen over Obsidian Sync (free)
- gemini-eval.mjs pattern used as template for llm-eval.mjs (correct approach)

## What Already Exists in This Repo
- **llm-eval.mjs** — Provider-agnostic evaluator. Reads `LLM_*` env vars and routes
  to any OpenAI-compatible API. Supports interactive and batch modes. Has presets
  for OpenRouter, Groq, DeepInfra, OpenAI.
  - Back-compat: falls back to `OPENROUTER_API_KEY` → `GROQ_API_KEY` with appropriate
    base URL defaults if `LLM_API_KEY` not set.
- **batch/batch-runner.sh** — Updated to call `node llm-eval.mjs` instead of
  `claude -p`. Provider-agnostic, picks up `LLM_*` config from .env.
- **package.json** — `openai` SDK dependency, `llm:eval` script.
- **.env.example** — Provider preset blocks for OpenRouter / Groq / DeepInfra / OpenAI.

## What Still Needs To Be Built
See CHECKLIST.md for full status. Summary:
- scan.mjs needs standalone LLM + Playwright rewrite
- Docker Compose setup
- Discord bot integration (webhook script, reaction handling)
- Obsidian note writer
- Syncthing setup on Droplet
- Cron scheduling
- cv.md and config/profile.yml need Dan's real content

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

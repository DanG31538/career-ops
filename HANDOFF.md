# Handoff Prompt — Paste into Fresh Chat

```
I'm continuing work on the career-ops fork in
C:\Users\DanTh\Documents\Coding\career-ops — a self-hosted job application
pipeline I've adapted from santifer/career-ops. Local dev on Windows
(PowerShell); production on a DigitalOcean droplet via Docker Compose.

Before doing anything: READ THESE TWO FILES IN FULL.
  - CLAUDE.md      — architecture, stack, current state, file inventory
  - CHECKLIST.md   — phase-by-phase progress + full decisions log
                     (skim the "Notes & Decisions Log" section at the
                     bottom; it has every tuning round and design call
                     made so far)

Current state (May 28, 2026):
  - Phases 0–4 ✅ complete
  - Phase 5a (Application Accelerators) ✅ complete
      - tailor-cv.mjs (per-JD tailored PDF resume)
      - draft-application.mjs (cover letter + custom Q&A)
  - Phase 5b.1 (Pipeline Processor) ✅ complete and tested
      - process-pipeline.mjs autonomously fetches JDs from
        Greenhouse/Ashby/Lever URLs in data/pipeline.md and runs
        llm-eval.mjs on each
      - Tested locally on 3 URLs — works end-to-end

What's next: **Phase 5b.2 — Discord Bot (discord-bot.mjs)**

Plan from CHECKLIST.md:
  - npm install discord.js
  - discord-bot.mjs (long-running):
      (a) Reads recently-generated reports/ files
      (b) Posts daily digest to #pipeline-status
          ("12 new evaluations overnight, 3 above 4.0/5")
      (c) Posts individual high-scoring evals to #job-alerts with
          attached PDF (tailor-cv.mjs) + ✅/❌ reactions
      (d) ✅ triggers draft-application.mjs (prompt me in a thread
          for --personal context); ❌ marks tracker as Discarded
      (e) Handle manual paste-a-URL workflow
  - docker-compose.yml CMD swap from `tail -f /dev/null` to
    `node discord-bot.mjs`
  - Test the full loop end-to-end on the droplet

Working preferences:
  - LLM is OpenRouter via the openai SDK (LLM_API_KEY in .env,
    llama-3.3-70b-instruct). Provider-agnostic by design — see
    PROVIDER_PRESETS in any of the *-eval / tailor / draft scripts.
  - Iterate on prompts incrementally — don't rewrite from scratch
    when I give feedback. The system has gone through 4–5 rounds
    of tuning on the cover-letter voice already.
  - For voice/tone work, expect multiple feedback rounds with me.
  - Ask before major refactors. Proceed without asking on clearly
    scoped follow-on work.
  - Don't introduce new heavy deps without justification.
  - .env is gitignored; user-layer files (cv.md, config/profile.yml,
    modes/_profile.md, portals.yml) ARE tracked in git for this fork
    (it's a private repo and the droplet needs them).

Known minor issues to revisit (not blocking):
  - Title cap inconsistency in modes/_profile.md Override 1 — fires
    for "Staff Research Engineer" but missed "Senior/Staff AI
    Research Engineer" with the intermediate "AI". May need regex
    broadening.
  - llm-eval.mjs occasionally produces an unparseable SCORE_SUMMARY
    block (saw it once in a 3-URL test). Worth a tighter mandatory-
    summary rule in the prompt.

Files to skim if relevant:
  - llm-eval.mjs           — provider-agnostic evaluator
  - tailor-cv.mjs          — modify-in-place resume tailor (ID-based mods)
  - draft-application.mjs  — cover letter + Q&A drafter
  - process-pipeline.mjs   — autonomous JD-fetch + eval orchestrator
  - lib/parse-cv.mjs       — shared deterministic cv.md parser
  - lib/strip-html.mjs     — HTML→text for fetched JDs
  - providers/*.mjs        — Ashby/Greenhouse/Lever scrapers + JD fetchers

Discord credentials are already in .env (DISCORD_BOT_TOKEN, channel IDs).
The bot's Discord side is created and added to my server.

Start by reading CLAUDE.md and CHECKLIST.md, confirm you understand
where we are, and propose the discord-bot.mjs structure before writing
any code.
```

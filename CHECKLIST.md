# Pipeline Build Checklist

## Phase 0 — Prerequisites ✅ COMPLETE
- [x] Repo forked from santifer/career-ops to DanG31538/career-ops (private)
- [x] Groq account created, API key generated
- [x] Discord server created, bot created, bot token generated
- [x] Discord channels created: #job-alerts, #needs-input, #pipeline-status, #bot-logs
- [x] Discord channel IDs collected and added to .env
- [x] DigitalOcean account created
- [x] Docker Desktop installed locally
- [x] Node.js v22.14.0 installed locally
- [x] Go 1.26.3 (amd64) installed locally
- [x] Git installed locally
- [x] .env created locally with placeholders
- [x] .env.example committed to repo
- [x] .gitignore verified — .env properly excluded
- [x] npm install run locally — 6 packages, 0 vulnerabilities
- [x] OpenRouter account created, API key generated (Groq Dev Tier was unavailable)

## Phase 1 — Droplet Provisioning ✅ COMPLETE
- [x] SSH key generated on desktop (ed25519)
- [x] DigitalOcean Droplet created (Ubuntu 24.04, $6/month, NYC3)
- [x] SSH access confirmed as root
- [x] apt update && apt upgrade run — 182 packages updated
- [x] Kernel upgraded to 6.8.0-117-generic
- [x] Docker 29.5.1 installed via get-docker.sh
- [x] Docker Compose v5.1.3 installed
- [x] Git installed on Droplet
- [x] jobops user created
- [x] jobops added to sudo and docker groups
- [x] SSH key copied to jobops user
- [x] UFW configured — OpenSSH allowed, firewall enabled
- [x] Repo cloned to /home/jobops/career-ops
- [x] .env created on Droplet with real credentials
- [x] Droplet rebooted, new kernel confirmed
- [x] SSH confirmed as jobops user

## Phase 2 — Swap LLM Backend ✅ COMPLETE (core)
- [x] llm-eval.mjs created (provider-agnostic, ~430 lines)
  - [x] Interactive mode: `node llm-eval.mjs "JD text"` or `--file <path>`
  - [x] Batch mode: `--file ... --report-num ... --id ... --url ... --date ...`
  - [x] Uses openai npm package with configurable baseURL
  - [x] Writes report to reports/ and tracker TSV to batch/tracker-additions/
  - [x] Reads LLM_* env vars; falls back to OPENROUTER_API_KEY → GROQ_API_KEY
  - [x] Provider presets for OpenRouter, Groq, DeepInfra, OpenAI baked in
  - [x] `--max-tokens` CLI flag (default 4096, configurable via LLM_MAX_TOKENS)
- [x] batch/batch-runner.sh updated — calls `node llm-eval.mjs`, provider-agnostic
- [x] package.json updated — openai dependency, `llm:eval` script
- [x] .env.example updated — LLM_* schema + provider preset blocks
- [x] .env locally updated — LLM_PROVIDER=openrouter, key slot empty for Dan to paste
- [x] npm install run locally after package.json update — 37 packages, 0 vulnerabilities
- [x] llm-eval.mjs tested locally with dummy JD (hit Groq TPM cap → confirmed error
      handler works; resolved by migrating to OpenRouter)
- [x] OpenRouter API key pasted into LLM_API_KEY + OPENROUTER_API_KEY in local .env
- [x] llm-eval.mjs tested locally with OpenRouter (dummy JD, Acme test) — score 4.2,
      SCORE_SUMMARY parsed cleanly, report saved as reports/001-acme-2026-05-23.md
- [x] Code changes committed + pushed (llm-eval.mjs, batch-runner.sh, package.json,
      .env.example)
- [x] git pull on Droplet successful
- [x] OpenRouter key added to Droplet .env
- [x] npm install run on Droplet (required fixing Node/npm via NodeSource first —
      Ubuntu apt-shipped npm choked on the modern lockfile)
- [x] llm-eval.mjs test run on Droplet (dummy JD) — eval printed successfully
- [ ] llm-eval.mjs tested with real job listing URL (deferred — useful once cv.md exists)
- [ ] scan.mjs rewritten — standalone LLM + Playwright, no Claude Code runtime
      (deferred to Phase 5/7 — needed once we want autonomous portal scanning)
- [ ] batch/batch-runner.sh --dry-run confirmed working on Droplet (deferred until
      batch-input.tsv has real entries)

## Phase 3 — Dockerize for Droplet 🔲 PENDING
- [ ] Dockerfile written for career-ops Node/Go environment
- [ ] docker-compose.yml written with career-ops service
- [ ] Volume mounts configured:
  - [ ] ./data
  - [ ] ./output
  - [ ] ./reports
  - [ ] ./cv.md
  - [ ] ./config/profile.yml
  - [ ] Obsidian vault directory
- [ ] restart policy: unless-stopped added
- [ ] docker compose up tested on Droplet
- [ ] Teardown and rebuild tested (portability verification)
- [ ] PDF generation wired in (node generate-pdf.mjs post-eval)

## Phase 4 — Personalize Profile ✅ COMPLETE
- [x] cv.md created with Dan's full resume in markdown
- [x] config/profile.yml created (target roles, $120K base floor, location prefs,
      dealbreakers, work auth, 7yr experience)
  - [x] Target roles filled in (8 ML archetypes: MLOps, NLP, CV, Generative AI,
        Applied ML, Data Scientist, Edge AI, Research Engineer)
  - [x] Salary floor set ($120K base — walk-away)
  - [x] Location preferences set (Remote > NYC metro > Pittsburgh)
  - [x] Dealbreakers set (off-list locations, clearance-required roles, sub-$120K base)
- [x] ML archetypes added to **modes/_profile.md** (NOT _shared.md per AGENTS.md user-layer rule):
  - [x] MLOps Engineer
  - [x] NLP Engineer
  - [x] Computer Vision Engineer
  - [x] Generative AI / LLM Engineer
  - [x] Edge AI / Robotics ML
  - [x] Data Scientist
  - [x] Research Engineer
  - [x] Applied ML Engineer (generalist)
  - [x] Adaptive framing table (archetype → which proof points to emphasize)
  - [x] Cross-cutting advantage narrative
  - [x] Location policy + clearance-skip rule
  - [x] Negotiation scripts adapted to Dan's situation
- [ ] LinkedIn URL pasted into config/profile.yml (currently TBD)
- [ ] portals.yml created from templates/portals.example.yml
  - [ ] ML/AI relevant companies kept
  - [ ] Irrelevant companies removed
  - [ ] Additional target companies added
- [x] Test eval run on real job listings — calibrated across 3 tuning rounds
      (Acme dummy, Relativity Principal Applied Scientist, NVIDIA closed posting).
      Title caps + closure detection both confirmed working end-to-end.
- [x] portals.yml created — curated ~30 ML/AI companies that work with
      scan.mjs's ATS providers (Ashby/Greenhouse/Lever). location_filter set
      to Remote / NYC metro / Pittsburgh. title_filter ML-focused. WebSearch-
      based companies omitted (would be silent no-ops without Playwright).
- [x] Clarified scan.mjs status — already works standalone, no rewrite needed.
      Pipeline processor (JD-fetch + invoke llm-eval.mjs) deferred to Phase 5.
- [ ] **NEXT: Commit + push Phase 4 files to GitHub**
- [ ] Pull Phase 4 files on Droplet + verify llm-eval.mjs + scan.mjs work there

## Phase 5 — Discord Integration 🔲 PENDING
- [ ] Discord webhook script written (Node.js)
  - [ ] Posts to #job-alerts when scanner finds match above threshold
  - [ ] Posts to #needs-input for custom questions
  - [ ] Listens for ✅/❌ reactions on #job-alerts
  - [ ] Thread reply handling for #needs-input answers
- [ ] Discord bot token added to .env
- [ ] Webhook script wired into scan flow as post-processing step
- [ ] UFW updated if Discord bot needs inbound port (likely outbound only, no change)
- [ ] Full loop tested: scan → #job-alerts → react → pipeline continues

## Phase 6 — Obsidian Tracking + Syncthing 🔲 PENDING
- [ ] Obsidian note schema designed (frontmatter fields)
- [ ] Note writer script created (converts TSV tracker entries to .md notes)
- [ ] Obsidian vault directory created on Droplet: ~/obsidian-vault/job-search/
- [ ] Syncthing installed on Droplet (apt install syncthing)
- [ ] Syncthing configured as headless service on Droplet
- [ ] UFW updated — Syncthing port 22000 opened
- [ ] Syncthing installed on desktop
- [ ] Syncthing installed on laptop
- [ ] All three devices paired
- [ ] job-search folder syncing confirmed
- [ ] Discord query command working — "show pipeline" returns summary
- [ ] Test note created on Droplet, confirmed appearing in Obsidian on desktop

## Phase 7 — Scheduling 🔲 PENDING
- [ ] Cron configured in Docker container:
  - [ ] 8am UTC scan run
  - [ ] 1pm UTC scan run
  - [ ] 6pm UTC scan run
- [ ] Rate limiting added between portal requests
- [ ] Follow-up reminder logic — ping #pipeline-status if status=applied for 7+ days
- [ ] Daily morning digest to #pipeline-status
- [ ] docker compose restart after cron config added
- [ ] Overnight run tested, #bot-logs checked in morning

## Phase 8 — Verification 🔲 PENDING
- [ ] Droplet rebooted: sudo reboot
- [ ] Containers confirmed auto-restarted (restart policy working)
- [ ] Discord bot confirmed reconnected after reboot
- [ ] Syncthing confirmed resumed after reboot
- [ ] Laptop test — Discord interaction works identically to desktop
- [ ] Full pipeline declared operational

## Notes & Decisions Log
- 2026-05-20: groq-eval.mjs uses gemini-eval.mjs as pattern — correct approach
- 2026-05-20: PDF generation deferred to Phase 3 — Groq returns text not files
- 2026-05-20: WebSearch/Playwright in batch mode deferred — same constraint as gemini
- 2026-05-20: scan.mjs rewrite needed — currently depends on Claude Code runtime
- 2026-05-20: Groq free tier: 14,400 req/day on 70B, 30 req/min — rate limit scan runs
- 2026-05-23: Initial groq-eval.mjs test hit Groq free-tier TPM cap (12k TPM on
  llama-3.3-70b-versatile). Confirmed: max_tokens reservation counts against TPM.
- 2026-05-23: Dropped default max_tokens 8192 → 4096 to fit Groq free tier.
- 2026-05-23: Groq Dev Tier signup unavailable (high demand). Evaluated alternatives:
  OpenRouter, DeepInfra, Cerebras, Fireworks, Together AI, OpenAI gpt-4o-mini.
  Picked OpenRouter — aggregator, one API key, no vendor lock-in, ~5% markup.
- 2026-05-23: Refactored groq-eval.mjs → llm-eval.mjs (provider-agnostic).
  - Provider config moves to .env via LLM_PROVIDER / LLM_BASE_URL / LLM_API_KEY
    / LLM_MODEL / LLM_MAX_TOKENS
  - Provider presets for OpenRouter (default), Groq, DeepInfra, OpenAI baked in
  - Switching providers is now a .env edit, no code change
  - batch-runner.sh, package.json, .env.example all updated
  - Back-compat: OPENROUTER_API_KEY / GROQ_API_KEY env fallbacks still work
- 2026-05-23: GROQ_API_KEY kept in .env as fallback. To switch back to Groq, blank
  out LLM_API_KEY (or set LLM_BASE_URL=https://api.groq.com/openai/v1 and
  LLM_MODEL=llama-3.3-70b-versatile).
- 2026-05-23: Droplet `sudo apt install npm` installed a broken npm that failed to
  pull `openai`. Fixed by purging apt nodejs/npm and installing Node 20 LTS via
  NodeSource. Phase 3 Docker setup will sidestep this entirely.
- 2026-05-23: Phase 2 closed — llm-eval.mjs works end-to-end on both local and
  droplet. Deferred items (real-URL test, scan.mjs rewrite, batch dry-run) are
  parked because they depend on Phase 4 personalization (cv.md, profile.yml).
- 2026-05-23: Phase 4 personalization in progress — cv.md, config/profile.yml,
  modes/_profile.md all created. PNC dates updated to "Aug 2020 – Apr 2026"
  (left this year, currently open to work). LinkedIn slug filled in.
- 2026-05-23: First real-JD calibration round:
  - **test-1** (4.8/5): user agrees → no tuning needed
  - **test-2** ("Scientist" title, scored high): user disagrees, role expects
    novel research / heavy math → added Role-Shape Caps section to _profile.md:
    Research Scientist tier capped at 3.0, heavy-theory roles capped at 3.5,
    academic/postdoc capped at 2.5. Exceptions for applied research and for
    research domains matching Dan's LLNL/CMU background.
  - **test-3** (no score, posting closed): system bailed instead of evaluating.
    Added Closed Posting Policy to _profile.md: always produce full A-G eval +
    SCORE_SUMMARY, mark Block G as "Closed/Expired", lead Block F with closure
    notice. Reasoning: eval data has reference value even when can't apply.
- 2026-05-24: Tuning round 2 (verification):
  - **test-2 re-run** (Relativity Principal Applied Scientist): cap STILL didn't
    fire — model produced 4.8 score, Block C never mentioned the cap rule. Root
    causes: (a) exact substring matching ("Principal Scientist" doesn't appear
    in "Principal Applied Scientist") (b) Role-Shape Caps was near bottom of
    _profile.md, attention dropoff. Fixed by rewriting modes/_profile.md with
    a top-of-file MANDATORY OVERRIDES section using semantic matching
    (seniority-word + scientist-word) + explicit examples + REQUIRED Block C
    "Title Cap Analysis:" line. Also folded in Closed Posting + Hard SKIP rules.
  - **test-3 re-run** (NVIDIA Senior Math Libraries Engineer): closure NOT
    detected because (a) my pattern list was too narrow — the JD uses
    "Applications for this job will be accepted at least until April 12, 2026"
    which my grep/rule didn't match, and (b) the LLM had no reliable "today"
    reference. First fix (insufficient):
    - `llm-eval.mjs`: injects today's date into the system prompt's operating
      rules so the LLM has an authoritative reference for date comparisons.
    - `modes/_profile.md` Override 3: expanded closure-signal list and added
      explicit "compare ANY application-related date against today" rule.
- 2026-05-24: Tuning round 3 — text-based rules STILL not enough.
  - test-3 v2 still produced no closure flag. The LLM was hallucinating "Posting
    age: 3 days (recent)" without scanning the JD for the deadline.
  - Root cause: LLMs are unreliable at deterministic pattern matching when
    the rule is buried in a long system prompt. Even with `today` injected,
    the model defaulted to filling in standard Block G template fields with
    plausible-sounding values.
  - Real fix: do the closure detection in JS code (deterministic regex), then
    **prepend a SYSTEM-DETECTED CLOSURE notice to the JD itself** (highest-
    attention slot — directly above the JD content the LLM is evaluating).
    `llm-eval.mjs` now has a `detectClosure(jdText, today)` function and
    constructs the user message with an explicit closure block when matched.
    The LLM no longer has to find the date — it's told the answer.

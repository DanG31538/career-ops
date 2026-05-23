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

## Phase 2 — Swap LLM Backend to Groq 🔲 IN PROGRESS
- [x] groq-eval.mjs created (~310 lines)
  - [x] Interactive mode: node groq-eval.mjs "JD text"
  - [x] Batch mode: node groq-eval.mjs --file ... --report-num ... --id ... 
  - [x] Uses openai npm package pointed at api.groq.com/openai/v1
  - [x] Writes report to reports/ and tracker TSV to batch/tracker-additions/
- [x] batch-runner.sh updated — replaces claude -p with node groq-eval.mjs
- [x] package.json updated — openai dependency added, groq:eval script added
- [ ] npm install run locally after package.json update
- [ ] groq-eval.mjs tested locally with dummy JD
- [ ] groq-eval.mjs tested with real job listing URL
- [ ] scan.mjs rewritten — standalone Groq + Playwright, no Claude Code runtime
- [ ] npm install run on Droplet
- [ ] git pull on Droplet after all Phase 2 changes pushed
- [ ] batch/batch-runner.sh --dry-run confirmed working on Droplet

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

## Phase 4 — Personalize Profile 🔲 PENDING
- [ ] cv.md created with Dan's full resume in markdown
- [ ] config/profile.yml created from profile.example.yml
  - [ ] Target roles filled in
  - [ ] Salary floor set
  - [ ] Location preferences set
  - [ ] Dealbreakers set
- [ ] ML archetypes added to modes/_shared.md:
  - [ ] LLMOps
  - [ ] MLOps
  - [ ] NLP Engineer
  - [ ] Computer Vision
  - [ ] Edge AI
- [ ] portals.yml created from templates/portals.example.yml
  - [ ] ML/AI relevant companies kept
  - [ ] Irrelevant companies removed
  - [ ] Additional target companies added
- [ ] Test eval run on real job listing — verify scoring makes sense

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
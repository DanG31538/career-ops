#!/usr/bin/env bash
# cron/run-pipeline.sh — autonomous overnight loop wrapper
# ------------------------------------------------------------
# Called by host cron three times a day. Runs scan.mjs to discover new
# postings, then process-pipeline.mjs to evaluate each (with auto-tailor
# on score ≥ 4.0). The bot's fs.watch picks up the new reports/*.md files
# and posts them to #job-alerts on its own — this script does not touch
# Discord directly.
#
# Failure handling: scan and process-pipeline are chained with `&&`, so
# a failed scan short-circuits without trying to evaluate (which would
# have nothing new to evaluate anyway). A failed process-pipeline isn't
# fatal — the next run picks up any URLs still marked [ ] in pipeline.md.
#
# Logging: stdout + stderr append to data/cron.log. Tail with:
#   tail -f /home/jobops/career-ops/data/cron.log
#
# Manual test (before letting cron drive it):
#   /home/jobops/career-ops/cron/run-pipeline.sh
# ------------------------------------------------------------

set -uo pipefail

REPO="/home/jobops/career-ops"
LOG="${REPO}/data/cron.log"
SERVICE="career-ops"

# Cap how many URLs one cron run will evaluate. Without this, a fresh scan
# that surfaces 100+ new URLs (post-junior-tier-filter changes) would burn
# ~50–90 min of runtime and ~$1 in LLM cost in a single run. With cron firing
# 3×/day at this cap, the system steadily drains backlog without spikes.
# Override per-run by editing this value (no rebuild needed — host file).
PROCESS_LIMIT=25

cd "${REPO}" || { echo "[$(date -Iseconds)] FATAL: cannot cd ${REPO}" >> "${LOG}"; exit 1; }

# Banner so log scrolling is parseable
{
  echo ""
  echo "============================================================"
  echo "  Cron run started: $(date -Iseconds)"
  echo "============================================================"
} >> "${LOG}"

# Step 1 — scan
echo "[$(date -Iseconds)] scan.mjs starting" >> "${LOG}"
docker compose exec -T "${SERVICE}" node scan.mjs >> "${LOG}" 2>&1
rc=$?
if [ "${rc}" -eq 0 ]; then
  echo "[$(date -Iseconds)] scan.mjs OK" >> "${LOG}"
else
  echo "[$(date -Iseconds)] scan.mjs FAILED (exit ${rc}), skipping process-pipeline" >> "${LOG}"
  exit 1
fi

# Step 2 — process-pipeline with auto-tailor for any newly-discovered URLs
echo "[$(date -Iseconds)] process-pipeline.mjs starting" >> "${LOG}"
docker compose exec -T "${SERVICE}" node process-pipeline.mjs --limit "${PROCESS_LIMIT}" --auto-tailor 4.0 >> "${LOG}" 2>&1
rc=$?
if [ "${rc}" -eq 0 ]; then
  echo "[$(date -Iseconds)] process-pipeline.mjs OK" >> "${LOG}"
else
  echo "[$(date -Iseconds)] process-pipeline.mjs FAILED (exit ${rc})" >> "${LOG}"
  exit 1
fi

echo "[$(date -Iseconds)] cron run complete" >> "${LOG}"

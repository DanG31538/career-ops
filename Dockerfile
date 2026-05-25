# career-ops — Self-hosted job application pipeline
# ------------------------------------------------------------
# Single-service container running Node 20 LTS. Provides
# llm-eval.mjs, scan.mjs, and batch-runner.sh on the droplet.
#
# The container stays alive via `tail -f /dev/null` (no long-
# running process yet — Phase 5 will swap this to a Discord
# bot CMD). Invoke work via:
#   docker compose exec career-ops node scan.mjs
#   docker compose exec career-ops node llm-eval.mjs --file jds/foo.txt
# ------------------------------------------------------------

FROM node:20-slim

# OS packages needed at runtime:
#   - bash:           batch/batch-runner.sh shebang requires it
#   - ca-certificates: TLS verification for HTTPS API calls
#   - curl:           debugging + occasional health-check probes
#   - tzdata:         needed if/when we want non-UTC scheduling
RUN apt-get update && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install npm dependencies in a separate layer so code edits don't
# invalidate the dependency cache. The lockfile is gitignored upstream,
# so the wildcard tolerates its absence.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy the rest of the project. .dockerignore strips operational data,
# secrets, git history, etc. so the image stays lean (~250MB target).
COPY . .

# Keep the container alive for `docker compose exec` invocations.
# Phase 5 swaps this for the Discord bot main process.
CMD ["tail", "-f", "/dev/null"]

# career-ops — Self-hosted job application pipeline
# ------------------------------------------------------------
# Single-service container running Node 20 LTS. Runs discord-bot.mjs
# as the main process (long-running). Provides llm-eval.mjs, scan.mjs,
# process-pipeline.mjs, tailor-cv.mjs and batch-runner.sh for `exec`.
#
#   docker compose up -d
#   docker compose logs -f
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

# Install Chromium for Playwright (used by tailor-cv.mjs → generate-pdf.mjs).
# --with-deps pulls the system libraries Chromium needs (fonts, libnss3, etc.)
# via apt under the hood. Adds ~300MB to the image but is required for PDF
# generation on the droplet. Without this, the bot's on-demand tailor fails
# with "browserType.launch: Executable doesn't exist" and posts have no PDF.
RUN npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*

# Copy the rest of the project. .dockerignore strips operational data,
# secrets, git history, etc. so the image stays lean.
COPY . .

# Long-running process: the Discord bot. docker-compose.yml's `command:`
# overrides this for clarity, but this CMD is the fallback if the compose
# command line is removed.
CMD ["node", "discord-bot.mjs"]

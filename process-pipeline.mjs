#!/usr/bin/env node
/**
 * process-pipeline.mjs — Autonomous JD-fetch + eval bridge
 *
 * Reads pending URLs from data/pipeline.md and processes each via
 * lib/process-one.mjs (which handles provider resolution, JD fetch,
 * llm-eval spawn, and optional tailor-cv spawn). This file owns the
 * outer loop: parsing pipeline.md, marking URLs as processed, and
 * logging every outcome to data/pipeline-log.tsv.
 *
 * Use case: scan.mjs runs overnight, finds 30 new offers. Cron triggers
 * process-pipeline.mjs which fetches each JD and evaluates it. By morning,
 * 30 reports sit in reports/ ready for triage.
 *
 * Usage:
 *   node process-pipeline.mjs                       # process all pending
 *   node process-pipeline.mjs --dry-run             # list pending, no fetch
 *   node process-pipeline.mjs --limit 5             # process only first 5
 *   node process-pipeline.mjs --auto-tailor 4.0     # also tailor when score >= 4.0
 *   node process-pipeline.mjs --max-tokens 3000     # passed to llm-eval.mjs
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

try { (await import('dotenv')).config(); } catch { /* dotenv optional */ }

import { processOneUrl } from './lib/process-one.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

const PATHS = {
  pipeline:     join(ROOT, 'data', 'pipeline.md'),
  logFile:      join(ROOT, 'data', 'pipeline-log.tsv'),
  providersDir: join(ROOT, 'providers'),
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args[0] === '--help' || args[0] === '-h') {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  career-ops — Pipeline Processor (autonomous JD-fetch + eval)    ║
╚══════════════════════════════════════════════════════════════════╝

  Reads pending URLs from data/pipeline.md, fetches each JD via its ATS
  API, runs llm-eval.mjs on each, and marks URLs as processed.

  USAGE
    node process-pipeline.mjs
    node process-pipeline.mjs --dry-run
    node process-pipeline.mjs --limit 5
    node process-pipeline.mjs --auto-tailor 4.0

  OPTIONS
    --dry-run             List pending URLs without fetching or evaluating
    --limit <n>           Process at most n URLs (default: all)
    --auto-tailor <score> Also spawn tailor-cv.mjs when score >= this value
    --max-tokens <n>      Passed to llm-eval.mjs (default: provider default)
    --model <name>        Passed to llm-eval.mjs (default: LLM_MODEL from .env)
    --help                Show this help
`);
  process.exit(0);
}

let dryRun = false;
let limit = Infinity;
let autoTailorThreshold = null;  // null = don't auto-tailor
let maxTokensOverride = null;
let modelOverride = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dry-run') dryRun = true;
  else if (a === '--limit' && args[i + 1]) {
    limit = parseInt(args[++i], 10);
    if (isNaN(limit) || limit <= 0) { console.error(`❌  Invalid --limit`); process.exit(1); }
  } else if (a === '--auto-tailor' && args[i + 1]) {
    autoTailorThreshold = parseFloat(args[++i]);
    if (isNaN(autoTailorThreshold)) { console.error(`❌  Invalid --auto-tailor threshold`); process.exit(1); }
  } else if (a === '--max-tokens' && args[i + 1]) {
    maxTokensOverride = args[++i];
  } else if (a === '--model' && args[i + 1]) {
    modelOverride = args[++i];
  }
}

// ---------------------------------------------------------------------------
// pipeline.md parsing + mutation
// ---------------------------------------------------------------------------
/**
 * Parse pending URLs from data/pipeline.md. Recognizes the format scan.mjs
 * writes: `- [ ] {url} | {company} | {title}` in the "## Pendientes" section.
 * Also tolerates URLs without the pipe-separated company/title.
 */
function parsePending(text) {
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  if (idx === -1) return [];
  const afterMarker = text.slice(idx + marker.length);
  const nextSection = afterMarker.search(/\n## /);
  const block = nextSection === -1 ? afterMarker : afterMarker.slice(0, nextSection);

  const entries = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const m = line.match(/^- \[ \]\s+(\S+)(?:\s*\|\s*([^|]+?))?(?:\s*\|\s*(.+?))?\s*$/);
    if (m) {
      entries.push({
        url: m[1],
        company: (m[2] || '').trim(),
        title: (m[3] || '').trim(),
        rawLine: line,
      });
    }
  }
  return entries;
}

// Toggle `- [ ]` to `- [x]` for a given URL line. In place; preserves all other lines.
function markProcessedInPipeline(text, url) {
  return text.split('\n').map(line => {
    if (line.includes('- [ ]') && line.includes(url)) {
      return line.replace('- [ ]', '- [x]');
    }
    return line;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function ensureLogHeader() {
  if (!existsSync(PATHS.logFile)) {
    writeFileSync(
      PATHS.logFile,
      'timestamp\turl\tcompany\ttitle\tstatus\tscore\treport_num\tpdf_path\terror\n',
      'utf-8'
    );
  }
}

function logResult({ url, company, title, status, score, reportNum, pdfPath, error }) {
  ensureLogHeader();
  const ts = new Date().toISOString();
  const safe = (v) => (v ?? '').toString().replace(/\t/g, ' ').replace(/\n/g, ' ');
  const line = [
    ts, safe(url), safe(company), safe(title), safe(status),
    safe(score), safe(reportNum), safe(pdfPath), safe(error),
  ].join('\t') + '\n';
  appendFileSync(PATHS.logFile, line, 'utf-8');
}

// ---------------------------------------------------------------------------
// Dry-run path needs provider resolution to print which ATS would match.
// Kept lightweight (no imports if not needed).
// ---------------------------------------------------------------------------
async function loadProvidersForDryRun() {
  const providers = new Map();
  if (!existsSync(PATHS.providersDir)) return providers;
  const files = readdirSync(PATHS.providersDir)
    .filter(f => f.endsWith('.mjs') && !f.startsWith('_'))
    .sort();
  for (const file of files) {
    const full = join(PATHS.providersDir, file);
    try {
      const mod = await import(pathToFileURL(full).href);
      const p = mod.default;
      if (p && p.id && typeof p.fetch === 'function') providers.set(p.id, p);
    } catch (err) {
      console.error(`⚠️   Failed to load provider ${file}: ${err.message}`);
    }
  }
  return providers;
}

function resolveProviderForUrl(url, providers) {
  const fakeEntry = { careers_url: url };
  for (const p of providers.values()) {
    if (typeof p.detect !== 'function') continue;
    try { if (p.detect(fakeEntry)) return p; } catch { /* try next */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log('\n📂  Loading pipeline...');

if (!existsSync(PATHS.pipeline)) {
  console.error(`❌  ${PATHS.pipeline} not found — run scan.mjs first.`);
  process.exit(1);
}

const pipelineText = readFileSync(PATHS.pipeline, 'utf-8');
const allPending = parsePending(pipelineText);
console.log(`   Pending URLs: ${allPending.length}`);

if (allPending.length === 0) {
  console.log('\n(nothing to process — pipeline.md is empty or has no "## Pendientes" entries)');
  process.exit(0);
}

const toProcess = allPending.slice(0, limit);
console.log(`   Will process: ${toProcess.length}${limit < Infinity ? ` (limited from ${allPending.length})` : ''}`);

if (dryRun) {
  console.log('\n=== DRY RUN ===');
  const providers = await loadProvidersForDryRun();
  for (const e of toProcess) {
    const provider = resolveProviderForUrl(e.url, providers);
    const providerId = provider ? provider.id : '(no provider matches)';
    console.log(`  ${providerId.padEnd(12)} ${e.company.padEnd(28)} ${e.title.slice(0, 50)}`);
    console.log(`               ${e.url}`);
  }
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const stats = { completed: 0, skipped: 0, failed: 0, tailored: 0 };

for (let i = 0; i < toProcess.length; i++) {
  const entry = toProcess[i];
  const { url, company, title } = entry;
  const idx = i + 1;
  console.log(`\n[${idx}/${toProcess.length}] ${company} — ${title}`);
  console.log(`         ${url}`);

  // Hand off to lib/process-one.mjs. Logging adapter prefixes each line
  // with the indent process-pipeline.mjs used historically.
  const result = await processOneUrl(url, {
    company,
    title,
    autoTailorThreshold,
    maxTokensOverride,
    modelOverride,
    onLog: (msg) => {
      // Match the historical 4-space-indent + emoji prefix where helpful.
      // We don't know the step from the message, so just indent.
      console.log(`    ${msg}`);
    },
  });

  if (result.status === 'skipped') {
    console.log(`    ⚠️   Skipped: ${result.reason}`);
    logResult({ url, company, title, status: 'skipped', error: result.reason });
    stats.skipped++;
    continue;
  }

  if (result.status === 'failed') {
    console.log(`    ❌  Failed: ${result.reason}`);
    logResult({
      url, company, title, status: 'failed',
      reportNum: result.reportNum, error: result.reason,
    });
    stats.failed++;
    continue;
  }

  // Completed
  const score = typeof result.evalResult?.score === 'number' ? result.evalResult.score : null;
  const scoreDisplay = score != null ? score.toFixed(1) : '?';
  console.log(`    ✅  Score: ${scoreDisplay}/5  |  Archetype: ${result.evalResult?.archetype || '?'}  |  Legitimacy: ${result.evalResult?.legitimacy || '?'}`);
  if (result.pdfPath) {
    console.log(`    🖨️   Tailored PDF: ${result.pdfPath}`);
    stats.tailored++;
  }

  // Mark URL as processed in pipeline.md (re-read in case the file changed)
  const updatedPipeline = markProcessedInPipeline(readFileSync(PATHS.pipeline, 'utf-8'), url);
  writeFileSync(PATHS.pipeline, updatedPipeline, 'utf-8');

  logResult({
    url,
    company: result.evalResult?.company || company,
    title,
    status: 'completed',
    score: scoreDisplay,
    reportNum: result.reportNum,
    pdfPath: result.pdfPath,
  });
  stats.completed++;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n' + '═'.repeat(66));
console.log(`  Pipeline Processed — ${today}`);
console.log('═'.repeat(66));
console.log(`  Completed:  ${stats.completed}`);
console.log(`  Tailored:   ${stats.tailored}`);
console.log(`  Skipped:    ${stats.skipped}`);
console.log(`  Failed:     ${stats.failed}`);
console.log(`  Log:        ${PATHS.logFile}`);
console.log('═'.repeat(66) + '\n');

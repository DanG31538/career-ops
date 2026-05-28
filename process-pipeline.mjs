#!/usr/bin/env node
/**
 * process-pipeline.mjs — Autonomous JD-fetch + eval bridge
 *
 * Bridges scan.mjs (which populates data/pipeline.md with URLs) and the
 * eval/tailor scripts (which need JD text). For each pending URL:
 *   1. Identify the ATS via the providers/ system
 *   2. Fetch JD body text via the provider's fetchJobDetail()
 *   3. Save JD to jds/auto-{timestamp}-{slug}.txt
 *   4. Spawn llm-eval.mjs in batch mode → produces report + tracker line
 *   5. If --auto-tailor and score >= threshold, also spawn tailor-cv.mjs
 *   6. Mark URL as [x] in pipeline.md (processed)
 *   7. Log result to data/pipeline-log.tsv
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

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn } from 'child_process';

try { (await import('dotenv')).config(); } catch { /* dotenv optional */ }

import { makeHttpCtx } from './providers/_http.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

const PATHS = {
  pipeline:   join(ROOT, 'data', 'pipeline.md'),
  jdsDir:     join(ROOT, 'jds'),
  reportsDir: join(ROOT, 'reports'),
  outputDir:  join(ROOT, 'output'),
  logFile:    join(ROOT, 'data', 'pipeline-log.tsv'),
  providersDir: join(ROOT, 'providers'),
  llmEval:    join(ROOT, 'llm-eval.mjs'),
  tailorCv:   join(ROOT, 'tailor-cv.mjs'),
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
// Helpers
// ---------------------------------------------------------------------------
function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'unknown';
}

async function loadProviders() {
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
      if (p && p.id && typeof p.fetch === 'function') {
        providers.set(p.id, p);
      }
    } catch (err) {
      console.error(`⚠️   Failed to load provider ${file}: ${err.message}`);
    }
  }
  return providers;
}

// Pick the provider whose detect() matches the given URL.
// Synthetic entry: detect() expects `careers_url`, so we feed it the job URL.
function resolveProviderForUrl(url, providers) {
  const fakeEntry = { careers_url: url };
  for (const p of providers.values()) {
    if (typeof p.detect !== 'function') continue;
    try {
      if (p.detect(fakeEntry)) return p;
    } catch { /* ignore detect errors, try next */ }
  }
  return null;
}

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
    // Match: - [ ] {url} optionally | {company} | {title}
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

// Compute next report number from reports/ directory (so llm-eval.mjs's --report-num matches)
function nextReportNumber() {
  if (!existsSync(PATHS.reportsDir)) return '001';
  const files = readdirSync(PATHS.reportsDir)
    .filter(f => /^\d{3}-/.test(f))
    .map(f => parseInt(f.slice(0, 3), 10))
    .filter(n => !isNaN(n));
  if (files.length === 0) return '001';
  return String(Math.max(...files) + 1).padStart(3, '0');
}

// Spawn llm-eval.mjs in batch mode and parse the final JSON line.
function spawnLlmEval({ jdPath, reportNum, id, url, date }) {
  return new Promise((resolve, reject) => {
    const args = [
      PATHS.llmEval,
      '--file', jdPath,
      '--report-num', reportNum,
      '--id', id,
      '--url', url,
      '--date', date,
    ];
    if (maxTokensOverride) args.push('--max-tokens', maxTokensOverride);
    if (modelOverride)     args.push('--model', modelOverride);

    const child = spawn('node', args, { cwd: ROOT, stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('exit', (code) => {
      // llm-eval.mjs batch mode prints a single JSON object as the last stdout line.
      const lastLine = stdout.trim().split('\n').filter(Boolean).pop() || '';
      let result;
      try { result = JSON.parse(lastLine); }
      catch { result = null; }
      if (code !== 0 || !result) {
        return reject(new Error(`llm-eval exited ${code}; stderr: ${stderr.trim().slice(0, 200)}`));
      }
      resolve(result);
    });
    child.on('error', reject);
  });
}

// Spawn tailor-cv.mjs (does not need to be parsed — we just want the PDF file produced).
function spawnTailorCv({ jdPath, company }) {
  return new Promise((resolve, reject) => {
    const args = [PATHS.tailorCv, '--file', jdPath];
    if (company) args.push('--company', company);
    if (maxTokensOverride) args.push('--max-tokens', maxTokensOverride);
    if (modelOverride)     args.push('--model', modelOverride);

    const child = spawn('node', args, { cwd: ROOT, stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`tailor-cv exited ${code}; stderr: ${stderr.trim().slice(0, 200)}`));
      // Look for "PDF: <path>" in stdout
      const pdfMatch = stdout.match(/PDF:\s+(\S+)/);
      resolve({ pdfPath: pdfMatch ? pdfMatch[1] : null });
    });
    child.on('error', reject);
  });
}

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
// Main
// ---------------------------------------------------------------------------
console.log('\n📂  Loading providers + pipeline...');

const providers = await loadProviders();
console.log(`   Providers loaded: ${[...providers.keys()].join(', ')}`);

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
  for (const e of toProcess) {
    const provider = resolveProviderForUrl(e.url, providers);
    const providerId = provider ? provider.id : '(no provider matches)';
    console.log(`  ${providerId.padEnd(12)} ${e.company.padEnd(28)} ${e.title.slice(0, 50)}`);
    console.log(`               ${e.url}`);
  }
  process.exit(0);
}

mkdirSync(PATHS.jdsDir, { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const stats = { completed: 0, skipped: 0, failed: 0, tailored: 0 };

for (let i = 0; i < toProcess.length; i++) {
  const entry = toProcess[i];
  const { url, company, title } = entry;
  const idx = i + 1;
  console.log(`\n[${idx}/${toProcess.length}] ${company} — ${title}`);
  console.log(`         ${url}`);

  // 1. Resolve provider
  const provider = resolveProviderForUrl(url, providers);
  if (!provider) {
    console.log('    ⚠️   No matching provider — skipping.');
    logResult({ url, company, title, status: 'skipped', error: 'no provider' });
    stats.skipped++;
    continue;
  }
  if (typeof provider.fetchJobDetail !== 'function') {
    console.log(`    ⚠️   Provider ${provider.id} has no fetchJobDetail — skipping.`);
    logResult({ url, company, title, status: 'skipped', error: `${provider.id}: no fetchJobDetail` });
    stats.skipped++;
    continue;
  }

  // 2. Fetch JD content
  let jd;
  try {
    const ctx = makeHttpCtx();
    jd = await provider.fetchJobDetail(url, ctx);
  } catch (err) {
    const msg = (err.message || String(err)).slice(0, 200);
    console.log(`    ❌  Fetch failed: ${msg}`);
    logResult({ url, company, title, status: 'failed', error: `fetch: ${msg}` });
    stats.failed++;
    continue;
  }

  if (!jd.text || jd.text.length < 200) {
    console.log(`    ⚠️   JD text too short (${jd.text?.length || 0} chars) — likely expired or restricted.`);
    logResult({ url, company, title, status: 'skipped', error: 'JD too short / likely expired' });
    stats.skipped++;
    continue;
  }

  // 3. Save JD to disk
  const reportNum = nextReportNumber();
  const slug = slugify(jd.title || title || 'unknown');
  const jdPath = join(PATHS.jdsDir, `auto-${reportNum}-${slug}.txt`);
  const jdFullText = `${jd.title}\n\nLocation: ${jd.location}\n\n${jd.text}`;
  writeFileSync(jdPath, jdFullText, 'utf-8');
  console.log(`    📝  JD saved: ${basename(jdPath)} (${jd.text.length} chars)`);

  // 4. Run llm-eval.mjs in batch mode
  console.log(`    🤖  Evaluating (report ${reportNum})...`);
  let evalResult;
  try {
    evalResult = await spawnLlmEval({
      jdPath,
      reportNum,
      id: reportNum,
      url,
      date: today,
    });
  } catch (err) {
    const msg = (err.message || String(err)).slice(0, 200);
    console.log(`    ❌  Eval failed: ${msg}`);
    logResult({ url, company, title, status: 'failed', reportNum, error: `eval: ${msg}` });
    stats.failed++;
    continue;
  }

  const score = typeof evalResult.score === 'number' ? evalResult.score : null;
  const scoreDisplay = score != null ? score.toFixed(1) : '?';
  console.log(`    ✅  Score: ${scoreDisplay}/5  |  Archetype: ${evalResult.archetype || '?'}  |  Legitimacy: ${evalResult.legitimacy || '?'}`);

  // 5. Optionally run tailor-cv.mjs for high-scoring offers
  let pdfPath = null;
  if (autoTailorThreshold != null && score != null && score >= autoTailorThreshold) {
    console.log(`    🖨️   Score >= ${autoTailorThreshold} → tailoring CV...`);
    try {
      const tailorResult = await spawnTailorCv({
        jdPath,
        company: evalResult.company || company,
      });
      pdfPath = tailorResult.pdfPath;
      console.log(`    ✅  Tailored PDF: ${basename(pdfPath || 'unknown')}`);
      stats.tailored++;
    } catch (err) {
      const msg = (err.message || String(err)).slice(0, 200);
      console.log(`    ⚠️   Tailor failed: ${msg}`);
      // Don't mark the whole job as failed — eval still succeeded
    }
  }

  // 6. Mark URL as processed in pipeline.md
  const updatedPipeline = markProcessedInPipeline(readFileSync(PATHS.pipeline, 'utf-8'), url);
  writeFileSync(PATHS.pipeline, updatedPipeline, 'utf-8');

  // 7. Log
  logResult({
    url, company: evalResult.company || company, title,
    status: 'completed', score: scoreDisplay, reportNum, pdfPath,
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

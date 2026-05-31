/**
 * lib/process-one.mjs — Process a single URL (resolve → fetch → eval → tailor)
 *
 * Extracted from process-pipeline.mjs so the same logic can be called from
 * the Discord bot (manual paste-a-URL workflow) without duplicating it.
 *
 * Returns a structured result; never throws for "expected" failures (no
 * provider, JD too short, eval failed) — caller decides how to surface
 * those. Throws only for truly unexpected errors (programmer bugs).
 *
 *   const result = await processOneUrl(url, {
 *     company,           // optional hint for logging/filenames
 *     title,             // optional hint
 *     reportNum,         // 3-digit string; auto-computed if omitted
 *     autoTailorThreshold,  // null = never; number = tailor when score >= this
 *     maxTokensOverride, // forwarded to llm-eval.mjs / tailor-cv.mjs
 *     modelOverride,     // forwarded to llm-eval.mjs / tailor-cv.mjs
 *     onLog,             // optional (msg) => void for per-step progress
 *   });
 *
 *   result.status: 'completed' | 'skipped' | 'failed'
 *   result.reason: short string when not completed
 *   result.report: parsed report object (from lib/parse-report.mjs) when completed
 *   result.reportFile: basename of report
 *   result.jdPath: full path to saved JD text file
 *   result.pdfPath: path to tailored PDF (when auto-tailored and successful)
 *   result.evalResult: raw JSON from llm-eval.mjs batch mode
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn } from 'child_process';

import { makeHttpCtx } from '../providers/_http.mjs';
import { parseReport } from './parse-report.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));  // lib/.. → repo root

const PATHS = {
  jdsDir:       join(ROOT, 'jds'),
  reportsDir:   join(ROOT, 'reports'),
  providersDir: join(ROOT, 'providers'),
  llmEval:      join(ROOT, 'llm-eval.mjs'),
  tailorCv:     join(ROOT, 'tailor-cv.mjs'),
};

// ---------------------------------------------------------------------------
// Internal helpers (kept private to this module)
// ---------------------------------------------------------------------------
function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'unknown';
}

function nextReportNumber() {
  if (!existsSync(PATHS.reportsDir)) return '001';
  const files = readdirSync(PATHS.reportsDir)
    .filter(f => /^\d{3}-/.test(f))
    .map(f => parseInt(f.slice(0, 3), 10))
    .filter(n => !isNaN(n));
  if (files.length === 0) return '001';
  return String(Math.max(...files) + 1).padStart(3, '0');
}

// Cache provider load — same Map structure as process-pipeline used to build.
let _providerCache = null;
async function loadProviders() {
  if (_providerCache) return _providerCache;
  const providers = new Map();
  if (!existsSync(PATHS.providersDir)) {
    _providerCache = providers;
    return providers;
  }
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
      // Best-effort load — keep going.
      // (caller can still detect "no provider" downstream)
      // eslint-disable-next-line no-console
      console.error(`⚠️   Failed to load provider ${file}: ${err.message}`);
    }
  }
  _providerCache = providers;
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

function spawnLlmEval({ jdPath, reportNum, id, url, date, maxTokensOverride, modelOverride }) {
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
      const lastLine = stdout.trim().split('\n').filter(Boolean).pop() || '';
      let result;
      try { result = JSON.parse(lastLine); } catch { result = null; }
      if (code !== 0 || !result) {
        return reject(new Error(`llm-eval exited ${code}; stderr: ${stderr.trim().slice(0, 200)}`));
      }
      resolve(result);
    });
    child.on('error', reject);
  });
}

function spawnTailorCv({ jdPath, company, maxTokensOverride, modelOverride }) {
  return new Promise((resolve, reject) => {
    const args = [PATHS.tailorCv, '--file', jdPath];
    if (company)           args.push('--company', company);
    if (maxTokensOverride) args.push('--max-tokens', maxTokensOverride);
    if (modelOverride)     args.push('--model', modelOverride);

    const child = spawn('node', args, { cwd: ROOT, stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`tailor-cv exited ${code}; stderr: ${stderr.trim().slice(0, 200)}`));
      const pdfMatch = stdout.match(/PDF:\s+(\S+)/);
      resolve({ pdfPath: pdfMatch ? pdfMatch[1] : null });
    });
    child.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function processOneUrl(url, opts = {}) {
  const log = typeof opts.onLog === 'function' ? opts.onLog : () => {};
  const today = new Date().toISOString().slice(0, 10);

  // 1. Resolve provider
  const providers = await loadProviders();
  const provider = resolveProviderForUrl(url, providers);
  if (!provider) {
    log('No matching provider for URL');
    return { status: 'skipped', reason: 'no provider', url };
  }
  if (typeof provider.fetchJobDetail !== 'function') {
    log(`Provider ${provider.id} lacks fetchJobDetail`);
    return { status: 'skipped', reason: `${provider.id}: no fetchJobDetail`, url };
  }

  // 2. Fetch JD content
  let jd;
  try {
    const ctx = makeHttpCtx();
    jd = await provider.fetchJobDetail(url, ctx);
  } catch (err) {
    const msg = (err.message || String(err)).slice(0, 200);
    log(`Fetch failed: ${msg}`);
    return { status: 'failed', reason: `fetch: ${msg}`, url };
  }
  if (!jd.text || jd.text.length < 200) {
    log(`JD text too short (${jd.text?.length || 0} chars) — likely expired/restricted`);
    return { status: 'skipped', reason: 'JD too short / likely expired', url };
  }

  // 3. Save JD to disk
  const reportNum = opts.reportNum || nextReportNumber();
  const slug = slugify(jd.title || opts.title || 'unknown');
  mkdirSync(PATHS.jdsDir, { recursive: true });
  const jdPath = join(PATHS.jdsDir, `auto-${reportNum}-${slug}.txt`);
  const jdFullText = `${jd.title}\n\nLocation: ${jd.location}\n\n${jd.text}`;
  writeFileSync(jdPath, jdFullText, 'utf-8');
  log(`JD saved: ${basename(jdPath)} (${jd.text.length} chars)`);

  // 4. Run llm-eval.mjs in batch mode
  log(`Evaluating (report ${reportNum})...`);
  let evalResult;
  try {
    evalResult = await spawnLlmEval({
      jdPath, reportNum,
      id: reportNum, url, date: today,
      maxTokensOverride: opts.maxTokensOverride,
      modelOverride: opts.modelOverride,
    });
  } catch (err) {
    const msg = (err.message || String(err)).slice(0, 200);
    log(`Eval failed: ${msg}`);
    return { status: 'failed', reason: `eval: ${msg}`, url, reportNum, jdPath };
  }

  const score = typeof evalResult.score === 'number' ? evalResult.score : null;

  // 5. Optionally run tailor-cv.mjs
  let pdfPath = null;
  const threshold = opts.autoTailorThreshold;
  if (threshold != null && score != null && score >= threshold) {
    log(`Score ${score.toFixed(1)} >= ${threshold} → tailoring CV...`);
    try {
      const tailorResult = await spawnTailorCv({
        jdPath,
        company: evalResult.company || opts.company,
        maxTokensOverride: opts.maxTokensOverride,
        modelOverride: opts.modelOverride,
      });
      pdfPath = tailorResult.pdfPath;
      log(`Tailored PDF: ${pdfPath ? basename(pdfPath) : '(no path captured)'}`);
    } catch (err) {
      const msg = (err.message || String(err)).slice(0, 200);
      log(`Tailor failed: ${msg}`);
      // Don't mark the whole job as failed — eval still succeeded.
    }
  }

  // 6. Locate the freshly-written report so callers can post / inspect it.
  const reportFile = findReportFileForNum(reportNum);
  const report = reportFile ? parseReport(join(PATHS.reportsDir, reportFile)) : null;

  return {
    status: 'completed',
    url,
    reportNum,
    reportFile,
    report,
    jdPath,
    pdfPath,
    evalResult,
  };
}

/**
 * Public helper for Discord bot's fs.watch — find the report file
 * matching a given report number prefix.
 */
export function findReportFileForNum(reportNum) {
  if (!existsSync(PATHS.reportsDir)) return null;
  const prefix = `${reportNum}-`;
  const match = readdirSync(PATHS.reportsDir).find(f => f.startsWith(prefix) && f.endsWith('.md'));
  return match || null;
}

/** Re-exported so callers don't need to duplicate the convention. */
export const REPORTS_DIR = PATHS.reportsDir;

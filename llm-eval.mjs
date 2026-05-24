#!/usr/bin/env node
/**
 * llm-eval.mjs — Provider-agnostic Job Offer Evaluator for career-ops
 *
 * Works with any OpenAI-compatible API:
 *   - OpenRouter (default)
 *   - Groq
 *   - DeepInfra
 *   - OpenAI (gpt-4o-mini etc.)
 *   - Any other provider that speaks the OpenAI chat-completions protocol
 *
 * Switching providers is a .env change, not a code change. See .env.example
 * for preset blocks.
 *
 * Reads evaluation logic from modes/oferta.md + modes/_shared.md, reads the
 * user's resume from cv.md, and evaluates a Job Description passed via
 * positional arg or --file.
 *
 * Usage:
 *   Interactive:
 *     node llm-eval.mjs "Paste full JD text here"
 *     node llm-eval.mjs --file ./jds/my-job.txt
 *     node llm-eval.mjs --model gpt-4o-mini "<JD text>"
 *
 *   Batch mode (called by batch/batch-runner.sh):
 *     node llm-eval.mjs --file /tmp/batch-jd-7.txt \
 *       --report-num 042 --id 7 \
 *       --url https://example.com/job/42 \
 *       --date 2026-05-21
 *
 * .env config (see .env.example):
 *   LLM_PROVIDER=openrouter           # label used in logs only
 *   LLM_BASE_URL=https://openrouter.ai/api/v1
 *   LLM_API_KEY=<your-key>
 *   LLM_MODEL=meta-llama/llama-3.3-70b-instruct
 *   LLM_MAX_TOKENS=4096
 *
 * Back-compat: if LLM_API_KEY is not set, falls back to OPENROUTER_API_KEY
 * (with OpenRouter defaults) or GROQ_API_KEY (with Groq defaults).
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Bootstrap: load .env before anything else
// ---------------------------------------------------------------------------
try {
  const { config } = await import('dotenv');
  config();
} catch {
  // dotenv is optional — fall back to process.env if not installed
}

import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const ROOT = dirname(fileURLToPath(import.meta.url));

const PATHS = {
  shared:       join(ROOT, 'modes', '_shared.md'),
  oferta:       join(ROOT, 'modes', 'oferta.md'),
  cv:           join(ROOT, 'cv.md'),
  profile:      join(ROOT, 'modes', '_profile.md'),
  profileYml:   join(ROOT, 'config', 'profile.yml'),
  reports:      join(ROOT, 'reports'),
  tracker:      join(ROOT, 'data', 'applications.md'),
  trackerAdds:  join(ROOT, 'batch', 'tracker-additions'),
};

// ---------------------------------------------------------------------------
// Provider presets — defaults applied when LLM_BASE_URL/LLM_MODEL aren't set
// ---------------------------------------------------------------------------
const PROVIDER_PRESETS = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model:   'meta-llama/llama-3.3-70b-instruct',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model:   'llama-3.3-70b-versatile',
  },
  deepinfra: {
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    model:   'meta-llama/Llama-3.3-70B-Instruct',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model:   'gpt-4o-mini',
  },
};

/**
 * Resolve provider config from env vars. Precedence:
 *   1) Fully explicit: LLM_API_KEY + LLM_BASE_URL + LLM_MODEL in .env
 *   2) Convenience:    OPENROUTER_API_KEY in .env → OpenRouter preset
 *   3) Legacy:         GROQ_API_KEY in .env → Groq preset
 * CLI --model still overrides .env LLM_MODEL.
 */
function resolveProvider() {
  const explicitKey   = process.env.LLM_API_KEY;
  const explicitBase  = process.env.LLM_BASE_URL;
  const explicitModel = process.env.LLM_MODEL;
  const explicitName  = process.env.LLM_PROVIDER;

  if (explicitKey) {
    return {
      provider: explicitName || 'custom',
      apiKey:   explicitKey,
      baseUrl:  explicitBase  || PROVIDER_PRESETS.openrouter.baseUrl,
      model:    explicitModel || PROVIDER_PRESETS.openrouter.model,
    };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      provider: 'openrouter',
      apiKey:   process.env.OPENROUTER_API_KEY,
      baseUrl:  explicitBase  || PROVIDER_PRESETS.openrouter.baseUrl,
      model:    explicitModel || PROVIDER_PRESETS.openrouter.model,
    };
  }
  if (process.env.GROQ_API_KEY) {
    return {
      provider: 'groq',
      apiKey:   process.env.GROQ_API_KEY,
      baseUrl:  explicitBase  || PROVIDER_PRESETS.groq.baseUrl,
      model:    explicitModel || PROVIDER_PRESETS.groq.model,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║      career-ops — LLM Evaluator (provider-agnostic)              ║
╚══════════════════════════════════════════════════════════════════╝

  Evaluate a job offer using any OpenAI-compatible provider.

  USAGE
    node llm-eval.mjs "<JD text>"
    node llm-eval.mjs --file ./jds/my-job.txt
    node llm-eval.mjs --model gpt-4o-mini "<JD text>"

  BATCH USAGE (called by batch/batch-runner.sh)
    node llm-eval.mjs --file /tmp/batch-jd-7.txt \\
      --report-num 042 --id 7 \\
      --url https://example.com/job/42 \\
      --date 2026-05-21

  OPTIONS
    --file <path>         Read JD from a file instead of inline text
    --model <name>        Override LLM_MODEL from .env
    --report-num <num>    Use specific report number (batch mode)
    --id <id>             Batch job ID (batch mode)
    --url <url>           Original job URL (batch mode, written into report header)
    --date <YYYY-MM-DD>   Date override (batch mode, default: today UTC)
    --no-save             Do not save report to reports/
    --max-tokens <n>      Output token budget (default: 4096 or LLM_MAX_TOKENS)
    --help                Show this help

  CONFIGURATION (in .env)
    LLM_PROVIDER=openrouter
    LLM_BASE_URL=https://openrouter.ai/api/v1
    LLM_API_KEY=<your-key>
    LLM_MODEL=meta-llama/llama-3.3-70b-instruct
    LLM_MAX_TOKENS=4096

    Or set OPENROUTER_API_KEY / GROQ_API_KEY for auto-config with presets.
    See .env.example for OpenRouter / Groq / DeepInfra / OpenAI preset blocks.
`);
  process.exit(0);
}

// Resolve provider before CLI parsing so --model can override
const providerConfig = resolveProvider();
if (!providerConfig) {
  console.error(`
❌  No LLM API key found.

   Set ONE of the following in .env:
     LLM_API_KEY=<key>            (preferred — works with any OpenAI-compatible provider)
     OPENROUTER_API_KEY=<key>     (auto-configures OpenRouter + Llama 3.3 70B)
     GROQ_API_KEY=<key>           (auto-configures Groq + Llama 3.3 70B Versatile)

   For non-default providers, also set:
     LLM_BASE_URL=https://...
     LLM_MODEL=<model-name>

   See .env.example for provider presets.
`);
  process.exit(1);
}

let jdText            = '';
let modelName         = providerConfig.model;
let saveReport        = true;
let reportNumOverride = null;
let batchId           = null;
let urlOverride       = null;
let dateOverride      = null;
// Default output budget kept low because some free tiers (notably Groq) count
// max_tokens against the per-minute TPM cap. 4096 fits a full A-G evaluation.
let maxTokens         = parseInt(process.env.LLM_MAX_TOKENS || '4096', 10);

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' && args[i + 1]) {
    const filePath = args[++i];
    if (!existsSync(filePath)) {
      console.error(`❌  File not found: ${filePath}`);
      process.exit(1);
    }
    jdText = readFileSync(filePath, 'utf-8').trim();
  } else if (args[i] === '--model' && args[i + 1]) {
    modelName = args[++i];
  } else if (args[i] === '--report-num' && args[i + 1]) {
    reportNumOverride = args[++i];
  } else if (args[i] === '--id' && args[i + 1]) {
    batchId = args[++i];
  } else if (args[i] === '--url' && args[i + 1]) {
    urlOverride = args[++i];
  } else if (args[i] === '--date' && args[i + 1]) {
    dateOverride = args[++i];
  } else if (args[i] === '--no-save') {
    saveReport = false;
  } else if (args[i] === '--max-tokens' && args[i + 1]) {
    maxTokens = parseInt(args[++i], 10);
    if (isNaN(maxTokens) || maxTokens <= 0) {
      console.error(`❌  Invalid --max-tokens value: must be a positive integer.`);
      process.exit(1);
    }
  } else if (!args[i].startsWith('--')) {
    jdText += (jdText ? '\n' : '') + args[i];
  }
}

// Batch mode = orchestrator passed --report-num. We then emit JSON to stdout
// instead of human-friendly logs, and write a tracker-additions TSV.
const isBatchMode = reportNumOverride !== null;

if (!jdText) {
  console.error('❌  No Job Description provided. Run with --help for usage.');
  process.exit(1);
}

// Compute today's date once. Used in (a) the system prompt so the LLM has a
// reliable "today" reference for closure detection / freshness checks, and
// (b) the report filename + frontmatter further down.
const today = dateOverride || new Date().toISOString().split('T')[0];

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------
function readFile(path, label) {
  if (!existsSync(path)) {
    if (!isBatchMode) {
      console.warn(`⚠️   ${label} not found at: ${path}`);
    }
    return `[${label} not found — skipping]`;
  }
  return readFileSync(path, 'utf-8').trim();
}

function nextReportNumber() {
  if (!existsSync(PATHS.reports)) return '001';
  const files = readdirSync(PATHS.reports)
    .filter(f => /^\d{3}-/.test(f))
    .map(f => parseInt(f.slice(0, 3), 10))
    .filter(n => !isNaN(n));
  if (files.length === 0) return '001';
  return String(Math.max(...files) + 1).padStart(3, '0');
}

function logInfo(msg) {
  // In batch mode we keep stdout clean for the final JSON line.
  if (!isBatchMode) {
    console.log(msg);
  }
}

function emitBatchFailure(err, partialState = {}) {
  const sanitized = (err.message || String(err))
    .split(providerConfig.apiKey).join('[REDACTED]');
  console.log(JSON.stringify({
    status:     'failed',
    id:         batchId,
    report_num: reportNumOverride,
    company:    partialState.company    || 'unknown',
    role:       partialState.role       || 'unknown',
    score:      null,
    legitimacy: partialState.legitimacy || 'unknown',
    pdf:        null,
    report:     partialState.reportPath || null,
    error:      sanitized,
  }));
}

/**
 * Deterministic JD closure detection.
 *
 * Why this exists: even when the closure date is literally in the JD and
 * today's date is in the system prompt, the LLM hallucinates "posting is
 * recent" rather than actually scanning the text. So we do the pattern
 * match in code and tell the LLM the answer.
 *
 * Returns { closed: bool, closureDate: string|null, matchedText: string|null }
 */
function detectClosure(text, todayStr) {
  // Each regex captures the date string in group 1. Order matters — more
  // specific patterns first so they win over generic ones.
  const patterns = [
    /(?:will\s+be\s+)?accepted\s+(?:at\s+least\s+)?(?:until|through)\s+([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i,
    /applications?\s+(?:must\s+be\s+)?received\s+by\s+([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i,
    /(?:applications?\s+)?clos(?:e|es|ed|ing)\s+(?:on\s+)?([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i,
    /(?:apply|submit)\s+by\s+([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i,
    /(?:application\s+)?deadline:?\s+([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i,
    /last\s+day\s+to\s+apply:?\s+([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i,
    /open\s+until\s+([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i,
  ];

  const todayDate = new Date(todayStr);
  if (isNaN(todayDate.getTime())) {
    return { closed: false, closureDate: null, matchedText: null };
  }

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const dateStr = match[1];
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) continue;
    if (parsed < todayDate) {
      return { closed: true,  closureDate: dateStr, matchedText: match[0] };
    }
    // Date is in the future — posting is still open, no need to flag.
    return { closed: false, closureDate: dateStr, matchedText: match[0] };
  }
  return { closed: false, closureDate: null, matchedText: null };
}

// ---------------------------------------------------------------------------
// Load context files
// ---------------------------------------------------------------------------
logInfo('\n📂  Loading context files...');

const sharedContext  = readFile(PATHS.shared,      'modes/_shared.md');
const ofertaLogic    = readFile(PATHS.oferta,      'modes/oferta.md');
const cvContent      = readFile(PATHS.cv,          'cv.md');
const profileContent = readFile(PATHS.profile,     'modes/_profile.md');
const profileYml     = readFile(PATHS.profileYml,  'config/profile.yml');

// ---------------------------------------------------------------------------
// Build the system prompt
// ---------------------------------------------------------------------------
const systemPrompt = `You are career-ops, an AI-powered job search assistant.
You evaluate job offers against the user's CV using a structured A-G scoring system.

Your evaluation methodology is defined below. Follow it exactly.

═══════════════════════════════════════════════════════
SYSTEM CONTEXT (_shared.md)
═══════════════════════════════════════════════════════
${sharedContext}

═══════════════════════════════════════════════════════
EVALUATION MODE (oferta.md)
═══════════════════════════════════════════════════════
${ofertaLogic}

═══════════════════════════════════════════════════════
CANDIDATE RESUME (cv.md)
═══════════════════════════════════════════════════════
${cvContent}

═══════════════════════════════════════════════════════
CANDIDATE PROFILE & TARGETS (config/profile.yml)
═══════════════════════════════════════════════════════
${profileYml}

═══════════════════════════════════════════════════════
USER ARCHETYPES & NARRATIVE (_profile.md)
═══════════════════════════════════════════════════════
${profileContent}

═══════════════════════════════════════════════════════
IMPORTANT OPERATING RULES FOR THIS HEADLESS SESSION
═══════════════════════════════════════════════════════

**Today's date (use this as the authoritative reference for ANY date comparison
in the JD — posting age, application deadlines, closure detection): ${today}**

If the JD contains a date that is in the past relative to today AND the date
relates to applications/submissions/deadlines, the posting is CLOSED. See
Override 3 in the candidate profile for closure handling.

1. You do NOT have access to WebSearch, Playwright, or file writing tools.
   - For Block D (Comp research): provide salary estimates based on your training data, clearly noted as estimates.
   - For Block G (Legitimacy): analyze the JD text only; skip URL/page freshness checks (mark as "unverified (batch mode)").
   - Post-evaluation file saving is handled by the script, not by you.
2. Generate Blocks A through G in full, in English, unless the JD is in another language.
3. At the very end, output a machine-readable summary block in this exact format:

---SCORE_SUMMARY---
COMPANY: <company name or "Unknown">
ROLE: <role title>
SCORE: <global score as decimal, e.g. 3.8>
ARCHETYPE: <detected archetype>
LEGITIMACY: <High Confidence | Proceed with Caution | Suspicious>
---END_SUMMARY---
`;

// ---------------------------------------------------------------------------
// Deterministic closure detection (do not rely on the LLM to pattern-match)
// ---------------------------------------------------------------------------
const closure = detectClosure(jdText, today);

let userMessage;
if (closure.closed) {
  logInfo(`⚠️   Closure detected: matched "${closure.matchedText}" → closure date ${closure.closureDate}, today is ${today}.`);
  userMessage =
    `[SYSTEM-DETECTED CLOSURE — APPLY OVERRIDE 3]\n` +
    `Pattern matcher found this JD is CLOSED:\n` +
    `  - Matched text: "${closure.matchedText}"\n` +
    `  - Closure date: ${closure.closureDate}\n` +
    `  - Today's date: ${today}\n` +
    `\n` +
    `Required handling (per Override 3 in candidate profile):\n` +
    `  - Block G "Legitimacy" MUST be "Closed/Expired" with closure date cited\n` +
    `  - Block F MUST lead with: "POSTING CLOSED ON ${closure.closureDate} — EVALUATION PRESERVED FOR REFERENCE, CANNOT APPLY"\n` +
    `  - Still produce complete A-G evaluation + SCORE_SUMMARY block (eval data has reference value)\n` +
    `  - Score normally; closure is captured in Block G, not in the numeric score\n` +
    `  - In SCORE_SUMMARY, set LEGITIMACY: Closed/Expired\n` +
    `\n` +
    `---\n` +
    `\n` +
    `JOB DESCRIPTION TO EVALUATE:\n\n${jdText}`;
} else if (closure.closureDate) {
  // Date found but still in the future — note it, don't flag closure.
  userMessage =
    `[SYSTEM NOTE: deadline detected "${closure.matchedText}" (${closure.closureDate}). Today is ${today}. Posting is still OPEN.]\n\n` +
    `JOB DESCRIPTION TO EVALUATE:\n\n${jdText}`;
} else {
  userMessage = `JOB DESCRIPTION TO EVALUATE:\n\n${jdText}`;
}

// ---------------------------------------------------------------------------
// Call the LLM (any OpenAI-compatible provider)
// ---------------------------------------------------------------------------
logInfo(`🤖  Calling ${providerConfig.provider} (${modelName})... this usually takes 10-30 seconds.\n`);

const client = new OpenAI({
  apiKey:  providerConfig.apiKey,
  baseURL: providerConfig.baseUrl,
});

let evaluationText;
try {
  const completion = await client.chat.completions.create({
    model:       modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage },
    ],
    temperature: 0.4,         // deterministic enough for structured evaluation
    max_tokens:  maxTokens,
  });
  evaluationText = completion.choices[0]?.message?.content || '';
  if (!evaluationText) {
    throw new Error('Empty response from provider');
  }
} catch (err) {
  if (isBatchMode) {
    emitBatchFailure(err);
    process.exit(1);
  }
  const sanitizedMsg = (err.message || '').split(providerConfig.apiKey).join('[REDACTED]');
  console.error(`❌  ${providerConfig.provider} API error:`, sanitizedMsg);
  if (sanitizedMsg.includes('API_KEY') || sanitizedMsg.includes('api_key') || sanitizedMsg.includes('401')) {
    console.error(`    Check your LLM_API_KEY in .env (or the ${providerConfig.provider.toUpperCase()}_API_KEY fallback).`);
  } else if (sanitizedMsg.includes('413') || sanitizedMsg.includes('too large') || sanitizedMsg.includes('TPM')) {
    console.error('    Request too large for the provider\'s rate limit.');
    console.error('    Try: --max-tokens 3000   OR   trim modes/_shared.md   OR   switch model in .env');
  } else if (sanitizedMsg.includes('quota') || sanitizedMsg.includes('rate') || sanitizedMsg.includes('429')) {
    console.error('    Rate limit hit. Wait 60s and retry, or switch provider in .env.');
  } else if (sanitizedMsg.includes('model') || sanitizedMsg.includes('404')) {
    console.error(`    Check that '${modelName}' is a valid model for ${providerConfig.provider}.`);
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Display evaluation (interactive mode only)
// ---------------------------------------------------------------------------
if (!isBatchMode) {
  console.log('\n' + '═'.repeat(66));
  console.log(`  CAREER-OPS EVALUATION — powered by ${providerConfig.provider}`);
  console.log('═'.repeat(66) + '\n');
  console.log(evaluationText);
}

// ---------------------------------------------------------------------------
// Parse score summary
// ---------------------------------------------------------------------------
const summaryMatch = evaluationText.match(
  /---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/
);

let company    = 'unknown';
let role       = 'unknown';
let score      = '?';
let archetype  = 'unknown';
let legitimacy = 'unknown';

if (summaryMatch) {
  const block = summaryMatch[1];
  const extract = (key) => {
    const prefix = `${key}:`;
    const lines = block.split('\n');
    for (const line of lines) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith(prefix)) {
        return trimmed.slice(prefix.length).trim();
      }
    }
    return 'unknown';
  };
  company    = extract('COMPANY');
  role       = extract('ROLE');
  score      = extract('SCORE');
  archetype  = extract('ARCHETYPE');
  legitimacy = extract('LEGITIMACY');
}

// ---------------------------------------------------------------------------
// Save report
// ---------------------------------------------------------------------------
let reportPath = null;
let reportNum  = reportNumOverride;
// `today` was already computed near the top of the file (used in system prompt).
const companySlug = company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';

if (saveReport) {
  try {
    if (!existsSync(PATHS.reports)) {
      mkdirSync(PATHS.reports, { recursive: true });
    }

    if (!reportNum) {
      reportNum = nextReportNumber();
    }

    const filename = `${reportNum}-${companySlug}-${today}.md`;
    reportPath = join(PATHS.reports, filename);

    const urlLine   = urlOverride ? `\n**URL:** ${urlOverride}` : '';
    const batchLine = batchId     ? `\n**Batch ID:** ${batchId}` : '';

    const reportContent = `# Evaluation: ${company} — ${role}

**Date:** ${today}
**Archetype:** ${archetype}
**Score:** ${score}/5
**Legitimacy:** ${legitimacy}${urlLine}
**PDF:** pending
**Tool:** ${providerConfig.provider} (${modelName})${batchLine}

---

${evaluationText.replace(/---SCORE_SUMMARY---[\s\S]*?---END_SUMMARY---/, '').trim()}
`;

    writeFileSync(reportPath, reportContent, 'utf-8');
    logInfo(`\n✅  Report saved: reports/${filename}`);
  } catch (err) {
    if (isBatchMode) {
      emitBatchFailure(err, { company, role, legitimacy });
      process.exit(1);
    }
    console.warn(`⚠️   Could not save report: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Batch mode: write tracker-additions TSV and emit final JSON to stdout.
// Interactive mode: print human-friendly tracker suggestion + summary.
// ---------------------------------------------------------------------------
if (isBatchMode) {
  try {
    if (!existsSync(PATHS.trackerAdds)) {
      mkdirSync(PATHS.trackerAdds, { recursive: true });
    }
    const trackerFilename = `${reportNum}-${companySlug}.tsv`;
    const trackerPath     = join(PATHS.trackerAdds, trackerFilename);
    const reportLink      = `[${reportNum}](reports/${reportNum}-${companySlug}-${today}.md)`;
    const noteText        = `Score ${score}/5, ${legitimacy}`;
    // PDF column = ❌ (Phase 2 limitation — the LLM can't generate PDFs; that's
    // handled by generate-pdf.mjs in a separate step / Phase 3).
    const tsvLine = [
      reportNum,
      today,
      company,
      role,
      'Evaluated',
      `${score}/5`,
      '❌',
      reportLink,
      noteText,
    ].join('\t') + '\n';
    writeFileSync(trackerPath, tsvLine, 'utf-8');
  } catch (err) {
    // Don't fail the whole job over a tracker write — just note it.
    console.error(`⚠️  Could not write tracker line: ${err.message}`);
  }

  // Final JSON to stdout for batch-runner.sh to parse.
  console.log(JSON.stringify({
    status:     'completed',
    id:         batchId,
    report_num: reportNum,
    company,
    role,
    score:      parseFloat(score) || null,
    legitimacy,
    pdf:        null,
    report:     reportPath,
    error:      null,
  }));
} else {
  if (saveReport) {
    console.log(`\n📊  Tracker entry (add to data/applications.md):`);
    console.log(`    | ${reportNum} | ${today} | ${company} | ${role} | ${score} | Evaluated | ❌ | [${reportNum}](reports/${reportNum}-${companySlug}-${today}.md) |`);
  }

  console.log('\n' + '─'.repeat(66));
  console.log(`  Score: ${score}/5  |  Archetype: ${archetype}  |  Legitimacy: ${legitimacy}`);
  console.log('─'.repeat(66) + '\n');
}

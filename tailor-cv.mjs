#!/usr/bin/env node
/**
 * tailor-cv.mjs — Per-JD tailored resume generator (modify-in-place)
 *
 * Architecture:
 *   1. Parse cv.md deterministically → structured `cv` object
 *      (jobs, bullets, skills, education are all explicit lists in code)
 *   2. Send the structured CV + JD to the LLM, ask for MODIFICATIONS only:
 *        - new summary text
 *        - 6-8 competency keyword phrases
 *        - per-job: bullet reordering (as indices) + optional bullet rewrites
 *        - skills: category reordering + optional category rewrites
 *   3. Apply mods in code — the canonical job/bullet/skills list lives in
 *      the parsed CV, so the LLM CANNOT drop content
 *   4. Render to HTML, spawn generate-pdf.mjs for PDF
 *
 * Why this design: an earlier version asked the LLM to regenerate all CV
 * content as JSON. That's a recall task and LLMs drop bullets. By moving
 * to "modifications on top of parsed content," dropping becomes impossible.
 *
 * Usage:
 *   node tailor-cv.mjs --file jds/test-1.txt
 *   node tailor-cv.mjs --file jds/test-1.txt --dry-run --keep-html
 *   node tailor-cv.mjs --file jds/test-1.txt --company Acme --format letter
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

try { (await import('dotenv')).config(); } catch { /* dotenv optional */ }

import OpenAI from 'openai';
import { parseCv } from './lib/parse-cv.mjs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const ROOT = dirname(fileURLToPath(import.meta.url));

const PATHS = {
  cv:         join(ROOT, 'cv.md'),
  profile:    join(ROOT, 'modes', '_profile.md'),
  profileYml: join(ROOT, 'config', 'profile.yml'),
  template:   join(ROOT, 'templates', 'cv-template.html'),
  output:     join(ROOT, 'output'),
  generatePdf: join(ROOT, 'generate-pdf.mjs'),
};

// ---------------------------------------------------------------------------
// Provider resolution (matches llm-eval.mjs)
// ---------------------------------------------------------------------------
const PROVIDER_PRESETS = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct' },
  groq:       { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  deepinfra:  { baseUrl: 'https://api.deepinfra.com/v1/openai', model: 'meta-llama/Llama-3.3-70B-Instruct' },
  openai:     { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
};

function resolveProvider() {
  const k = process.env.LLM_API_KEY;
  const b = process.env.LLM_BASE_URL;
  const m = process.env.LLM_MODEL;
  const n = process.env.LLM_PROVIDER;
  if (k) return { provider: n || 'custom', apiKey: k, baseUrl: b || PROVIDER_PRESETS.openrouter.baseUrl, model: m || PROVIDER_PRESETS.openrouter.model };
  if (process.env.OPENROUTER_API_KEY)
    return { provider: 'openrouter', apiKey: process.env.OPENROUTER_API_KEY, baseUrl: b || PROVIDER_PRESETS.openrouter.baseUrl, model: m || PROVIDER_PRESETS.openrouter.model };
  if (process.env.GROQ_API_KEY)
    return { provider: 'groq', apiKey: process.env.GROQ_API_KEY, baseUrl: b || PROVIDER_PRESETS.groq.baseUrl, model: m || PROVIDER_PRESETS.groq.model };
  return null;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║      career-ops — CV Tailor (per-JD resume generator)            ║
╚══════════════════════════════════════════════════════════════════╝

  Generates a tailored resume for a specific JD by reordering bullets
  and reframing wording — never dropping or inventing content.

  USAGE
    node tailor-cv.mjs "<JD text>"
    node tailor-cv.mjs --file jds/test-1.txt
    node tailor-cv.mjs --file jds/test-1.txt --dry-run --keep-html

  OPTIONS
    --file <path>         Read JD from a file
    --model <name>        Override LLM_MODEL
    --max-tokens <n>      Output token budget (default 4096)
    --company <name>      Override company name (used for filename)
    --format letter|a4    Page format (auto-detected from JD if unset)
    --output <path>       Override PDF output path
    --keep-html           Keep the intermediate HTML file
    --dry-run             Build HTML but skip the PDF step
    --help                Show this help
`);
  process.exit(0);
}

let jdText = '';
let modelOverride = null;
let maxTokens = parseInt(process.env.LLM_MAX_TOKENS || '4096', 10);
let companyOverride = null;
let formatOverride = null;
let outputOverride = null;
let keepHtml = false;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--file' && args[i + 1]) {
    const fp = args[++i];
    if (!existsSync(fp)) { console.error(`❌  File not found: ${fp}`); process.exit(1); }
    jdText = readFileSync(fp, 'utf-8').trim();
  } else if (a === '--model' && args[i + 1]) {
    modelOverride = args[++i];
  } else if (a === '--max-tokens' && args[i + 1]) {
    maxTokens = parseInt(args[++i], 10);
    if (isNaN(maxTokens) || maxTokens <= 0) { console.error(`❌  Invalid --max-tokens`); process.exit(1); }
  } else if (a === '--company' && args[i + 1]) {
    companyOverride = args[++i];
  } else if (a === '--format' && args[i + 1]) {
    formatOverride = args[++i].toLowerCase();
    if (!['letter', 'a4'].includes(formatOverride)) { console.error(`❌  --format must be letter or a4`); process.exit(1); }
  } else if (a === '--output' && args[i + 1]) {
    outputOverride = args[++i];
  } else if (a === '--keep-html') {
    keepHtml = true;
  } else if (a === '--dry-run') {
    dryRun = true;
  } else if (!a.startsWith('--')) {
    jdText += (jdText ? '\n' : '') + a;
  }
}

if (!jdText) { console.error('❌  No JD provided. Run with --help for usage.'); process.exit(1); }

const providerConfig = resolveProvider();
if (!providerConfig) {
  console.error(`❌  No LLM API key found. Set LLM_API_KEY (or OPENROUTER_API_KEY / GROQ_API_KEY) in .env.`);
  process.exit(1);
}
const modelName = modelOverride || providerConfig.model;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readFileOrEmpty(path, label) {
  if (!existsSync(path)) {
    console.warn(`⚠️   ${label} not found at: ${path}`);
    return '';
  }
  return readFileSync(path, 'utf-8');
}

function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Tiny YAML reader for profile.yml (just enough for the contact-row)
function readProfileYml(path) {
  if (!existsSync(path)) return { candidate: {}, cv: {} };
  const text = readFileSync(path, 'utf-8');
  const out = { candidate: {}, cv: {} };
  let section = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^[a-z_]+:\s*$/i.test(line)) { section = line.trim().slice(0, -1); continue; }
    const m = line.match(/^\s{2,}([a-z_]+):\s*"?([^"]*?)"?\s*$/i);
    if (m && section) {
      out[section] = out[section] || {};
      out[section][m[1]] = m[2];
    }
  }
  return out;
}

// cv.md parser lives in lib/parse-cv.mjs (shared with draft-application.mjs).

// ---------------------------------------------------------------------------
// Load + parse CV
// ---------------------------------------------------------------------------
console.log('\n📂  Loading and parsing cv.md...');

const cvRaw = readFileOrEmpty(PATHS.cv, 'cv.md');
if (!cvRaw.trim()) {
  console.error('❌  cv.md is empty or missing — cannot tailor a resume.');
  process.exit(1);
}
const cv = parseCv(cvRaw);

// Report what we parsed (useful for debugging)
console.log(`   Name: ${cv.name}`);
console.log(`   Summary: ${cv.summary.length} chars`);
console.log(`   Experience: ${cv.experience.length} entries (${cv.experience.map(e => `${e.id}=${e.company}/${e.bullets.length}b`).join(', ')})`);
console.log(`   Service:    ${cv.service.length} entries (${cv.service.map(e => `${e.id}=${e.company}`).join(', ')})`);
console.log(`   Education:  ${cv.education.length} entries`);
console.log(`   Skills:     ${cv.skills.length} categories (${cv.skills.map(s => s.id).join(', ')})`);

if (cv.experience.length === 0) {
  console.error('❌  Parser found no experience entries — check cv.md format.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load remaining context
// ---------------------------------------------------------------------------
const profileMd = readFileOrEmpty(PATHS.profile, 'modes/_profile.md');
const profileYmlRaw = readFileOrEmpty(PATHS.profileYml, 'config/profile.yml');
const profileData = readProfileYml(PATHS.profileYml);
const template = readFileOrEmpty(PATHS.template, 'templates/cv-template.html');
if (!template) {
  console.error('❌  cv-template.html missing — cannot generate PDF.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Page format detection (US JD → letter, EU → a4)
// ---------------------------------------------------------------------------
function detectFormat(jd) {
  const t = jd.toLowerCase();
  if (/(united kingdom|\buk\b|london|cambridge|edinburgh|germany|berlin|munich|france|paris|spain|madrid|barcelona|italy|milan|netherlands|amsterdam|ireland|dublin|sweden|stockholm|switzerland|zurich)/.test(t))
    return 'a4';
  return 'letter';
}
const pageFormat = formatOverride || detectFormat(jdText);
const pageWidth = pageFormat === 'letter' ? '8.5in' : '210mm';

// ---------------------------------------------------------------------------
// Build the LLM prompt — asks for MODIFICATIONS only, not full content
// ---------------------------------------------------------------------------
// We include the parsed CV with stable IDs so the LLM references entities
// by ID, not by array position. IDs survive cv.md edits + reorderings.
const cvForLLM = {
  name: cv.name,
  summary: cv.summary,
  experience: cv.experience.map(e => ({
    id: e.id,
    role: e.role,
    company: e.company,
    period: e.period,
    location: e.location,
    bullets: e.bullets,  // each is {id, text}
  })),
  service: cv.service.map(s => ({
    id: s.id,
    role: s.role, company: s.company, period: s.period, location: s.location,
    bullets: s.bullets, description: s.description,
  })),
  education: cv.education,
  skills: cv.skills,  // each is {id, category, items}
};

const systemPrompt = `You are career-ops CV Tailor. You receive a structured CV (already parsed,
with stable IDs on every job, bullet, and skill category) and a job description.
You produce MODIFICATIONS — never new content from scratch. The code is the
canonical source of structure; you only reorder + reword.

═══════════════════════════════════════════════════════
ID CONVENTIONS
═══════════════════════════════════════════════════════
- Experience jobs:  "exp-1", "exp-2", ...
- Service entries:  "srv-1", "srv-2", ...
- Education:        "edu-1", "edu-2", ...
- Skill categories: "skill-1", "skill-2", ...
- Bullets:          "b-{parent-id}-{n}" — e.g. "b-exp-1-3" is the 3rd bullet
                    under exp-1
ALWAYS reference entities by these IDs in your output. Never use array
positions, company names, or category names as identifiers — IDs only.

═══════════════════════════════════════════════════════
WHAT YOU CAN MODIFY
═══════════════════════════════════════════════════════
1. SUMMARY — Rewrite the candidate's professional summary. Rules:
   - Describe the CANDIDATE (e.g. "Machine Learning Engineer with 7 years...")
   - Use JD vocabulary ONLY where it describes existing skills/experience
   - NEVER mention the specific company or role being applied to
   - NEVER use phrases like "looking for", "excited about", "applying to"
   - NEVER claim a skill or metric not in the parsed CV

2. COMPETENCIES — Generate 6-8 keyword phrases combining the candidate's
   actual skills with JD vocabulary. This grid is JD-aware (intentional).

3. EXPERIENCE — For each job (and optionally each service entry), you can:
   (a) Reorder bullets — "bullet_order" is an array of bullet IDs in the
       new order. Most-JD-relevant bullet ID first. If you omit any IDs,
       the missing bullets get appended at the end automatically (so we
       never lose content), but please include every ID exactly once.
   (b) Rewrite specific bullets — "bullet_rewrites" is an object keyed by
       BULLET ID, with the rewritten text as the value. Only include
       bullets you actually want to reword. Rewrites must preserve the
       underlying fact (re-vocabulary only — never invent metrics).

4. SKILLS — Reorder skill categories and optionally rewrite the items list:
   (a) category_order: array of skill-category IDs in new order, e.g.
       ["skill-2", "skill-3", "skill-1", ...]. Missing IDs auto-append.
   (b) category_rewrites: object keyed by SKILL CATEGORY ID, with the
       reordered/reworded items string as the value.

═══════════════════════════════════════════════════════
WHAT YOU MUST NOT DO
═══════════════════════════════════════════════════════
- Do NOT drop any job, bullet, or skill category — the code holds those
  as the canonical list; you only modify them
- Do NOT invent skills, metrics, projects, or experience
- Do NOT mention the JD's company or role in the summary
- Do NOT reference entities by name or position — use IDs only
- Do NOT include education in your output — it's unchanged

═══════════════════════════════════════════════════════
PARSED CV (canonical — reference entities by their "id" field)
═══════════════════════════════════════════════════════
${JSON.stringify(cvForLLM, null, 2)}

═══════════════════════════════════════════════════════
ARCHETYPES + ADAPTIVE FRAMING (modes/_profile.md)
═══════════════════════════════════════════════════════
${profileMd}

═══════════════════════════════════════════════════════
OUTPUT FORMAT — RETURN ONLY A SINGLE JSON OBJECT
═══════════════════════════════════════════════════════
{
  "company": "Detected company name from JD",
  "role_title": "Detected role title from JD",
  "archetype": "Detected archetype",
  "summary": "New summary text (full rewrite)",
  "competencies": ["phrase 1", "phrase 2", "...", "phrase 8"],
  "experience_mods": [
    {
      "job_id": "exp-1",
      "bullet_order": ["b-exp-1-3", "b-exp-1-1", "b-exp-1-5", "b-exp-1-2", "b-exp-1-4", "b-exp-1-6", "b-exp-1-7"],
      "bullet_rewrites": {
        "b-exp-1-1": "Reworded version of that bullet (optional — omit if no rewrite needed)"
      }
    }
    // ... one entry per job (and optionally one per service entry, by srv-X id)
  ],
  "skills_mods": {
    "category_order": ["skill-2", "skill-3", "skill-1"],
    "category_rewrites": {
      "skill-2": "TensorFlow, PyTorch, ... (reordered items with JD-relevant first)"
    }
  }
}

NO PROSE BEFORE OR AFTER THE JSON. NO MARKDOWN FENCES.
`;

const userMessage = `JOB DESCRIPTION:\n\n${jdText}`;

// ---------------------------------------------------------------------------
// Call LLM (with json_object response format + retry)
// ---------------------------------------------------------------------------
console.log(`🤖  Calling ${providerConfig.provider} (${modelName}) for modifications...`);

const client = new OpenAI({ apiKey: providerConfig.apiKey, baseURL: providerConfig.baseUrl });

async function callOnce(strictExtra = '') {
  const sys = strictExtra ? systemPrompt + '\n\n' + strictExtra : systemPrompt;
  const completion = await client.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: sys },
      { role: 'user',   content: userMessage },
    ],
    temperature: 0.4,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },  // belt-and-suspenders against malformed JSON
  });
  return completion.choices[0]?.message?.content || '';
}

function extractJsonObject(text) {
  let t = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim();
  const first = t.indexOf('{');
  const last  = t.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  return t.slice(first, last + 1);
}

let mods, raw;
try {
  raw = await callOnce();
  const json = extractJsonObject(raw);
  if (!json) throw new Error('No JSON object in response');
  mods = JSON.parse(json);
} catch (err) {
  console.warn(`⚠️   First attempt failed (${err.message}). Retrying with stricter prompt...`);
  try {
    raw = await callOnce('CRITICAL: previous response did not parse. Return ONLY the JSON object — no prose, no fences, no leading or trailing text.');
    const json = extractJsonObject(raw);
    if (!json) throw new Error('No JSON object in retry response');
    mods = JSON.parse(json);
  } catch (err2) {
    const sanitized = (err2.message || '').split(providerConfig.apiKey).join('[REDACTED]');
    console.error(`❌  Failed to parse JSON from LLM after retry: ${sanitized}`);
    mkdirSync(PATHS.output, { recursive: true });
    const dumpPath = join(PATHS.output, `_tailor-debug-${Date.now()}.txt`);
    writeFileSync(dumpPath, raw, 'utf-8');
    console.error(`    Raw response dumped to: ${dumpPath}`);
    process.exit(1);
  }
}

console.log(`✅  Modifications received (company: ${mods.company || 'unknown'}, archetype: ${mods.archetype || 'unknown'}).`);

// ---------------------------------------------------------------------------
// APPLY MODIFICATIONS — code owns the canonical structure
// ---------------------------------------------------------------------------
function applyMods(cv, mods) {
  const tailored = JSON.parse(JSON.stringify(cv));  // deep copy
  const report = [];

  // Build a flat lookup of all job-like entries (experience + service) by ID
  // so the LLM can target either kind from experience_mods with one job_id.
  const allJobs = [...tailored.experience, ...tailored.service];
  const jobById  = new Map(allJobs.map(j => [j.id, j]));
  const skillById = new Map(tailored.skills.map(s => [s.id, s]));

  // Summary
  if (mods.summary && typeof mods.summary === 'string') {
    tailored.summary = mods.summary.trim();
    report.push('summary: rewritten');
  }

  // Competencies (JD-specific, generated fresh each run)
  tailored.competencies = Array.isArray(mods.competencies) ? mods.competencies : [];
  report.push(`competencies: ${tailored.competencies.length}`);

  // Experience / service modifications by job_id
  if (Array.isArray(mods.experience_mods)) {
    for (const em of mods.experience_mods) {
      const jobId = em.job_id;
      if (!jobId) {
        report.push('⚠️  experience_mod missing job_id — skipped');
        continue;
      }
      const entry = jobById.get(jobId);
      if (!entry) {
        report.push(`⚠️  experience_mod for "${jobId}": unknown job_id — skipped`);
        continue;
      }
      const originalCount = entry.bullets.length;
      const bulletById = new Map(entry.bullets.map(b => [b.id, b]));

      // Apply rewrites first (key = bullet id, value = new text)
      let rewriteCount = 0;
      if (em.bullet_rewrites && typeof em.bullet_rewrites === 'object') {
        for (const [bid, text] of Object.entries(em.bullet_rewrites)) {
          if (typeof text !== 'string' || !text.trim()) continue;
          const bullet = bulletById.get(bid);
          if (bullet) {
            bullet.text = text.trim();
            rewriteCount++;
          }
        }
      }

      // Then reorder (bullet_order is an array of bullet IDs)
      if (Array.isArray(em.bullet_order)) {
        const reordered = [];
        const seen = new Set();
        for (const bid of em.bullet_order) {
          if (typeof bid !== 'string' || seen.has(bid)) continue;
          const bullet = bulletById.get(bid);
          if (bullet) {
            reordered.push(bullet);
            seen.add(bid);
          }
        }
        // Append any bullets the LLM forgot — we NEVER drop content
        for (const b of entry.bullets) {
          if (!seen.has(b.id)) reordered.push(b);
        }
        entry.bullets = reordered;
      }

      if (entry.bullets.length !== originalCount) {
        report.push(`⚠️  ${entry.company} (${entry.id}): bullet count changed ${originalCount} → ${entry.bullets.length}`);
      } else {
        const reorderMsg = Array.isArray(em.bullet_order) ? 'reordered' : 'order unchanged';
        report.push(`${entry.company} (${entry.id}): ${originalCount} bullets preserved, ${rewriteCount} reworded, ${reorderMsg}`);
      }
    }
  }

  // Skills modifications by skill ID
  if (mods.skills_mods && typeof mods.skills_mods === 'object') {
    if (Array.isArray(mods.skills_mods.category_order)) {
      const reordered = [];
      const seen = new Set();
      for (const sid of mods.skills_mods.category_order) {
        if (typeof sid !== 'string' || seen.has(sid)) continue;
        const skill = skillById.get(sid);
        if (skill) {
          reordered.push(skill);
          seen.add(sid);
        }
      }
      for (const s of tailored.skills) {
        if (!seen.has(s.id)) reordered.push(s);
      }
      tailored.skills = reordered;
      report.push('skills: reordered');
    }
    if (mods.skills_mods.category_rewrites && typeof mods.skills_mods.category_rewrites === 'object') {
      let n = 0;
      for (const [sid, items] of Object.entries(mods.skills_mods.category_rewrites)) {
        if (typeof items !== 'string' || !items.trim()) continue;
        const skill = skillById.get(sid);
        if (skill) {
          skill.items = items.trim();
          n++;
        }
      }
      if (n) report.push(`skills: ${n} categories reworded`);
    }
  }

  return { tailored, report };
}

const { tailored, report: modReport } = applyMods(cv, mods);

console.log('   Modifications applied:');
modReport.forEach(r => console.log(`     - ${r}`));

// ---------------------------------------------------------------------------
// Render HTML
// ---------------------------------------------------------------------------
function renderCompetencies(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items.map(c => `<span class="competency-tag">${escapeHtml(c)}</span>`).join('\n      ');
}

function renderJobLike(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  return entries.map(e => {
    const locationHtml = e.location ? `<span class="job-location">— ${escapeHtml(e.location)}</span>` : '';
    let bodyHtml = '';
    if (Array.isArray(e.bullets) && e.bullets.length) {
      // Bullets are {id, text} objects post-parser; fall back to plain
      // strings if the structure ever shifts.
      bodyHtml = `    <ul>
${e.bullets.map(b => `      <li>${escapeHtml(b && b.text !== undefined ? b.text : b)}</li>`).join('\n')}
    </ul>`;
    } else if (e.description) {
      bodyHtml = `    <div class="summary-text" style="margin-top:6px">${escapeHtml(e.description)}</div>`;
    }
    return `
  <div class="job">
    <div class="job-header">
      <span class="job-company">${escapeHtml(e.company)}</span>
      <span class="job-period">${escapeHtml(e.period)}</span>
    </div>
    <div class="job-role">${escapeHtml(e.role)} ${locationHtml}</div>
${bodyHtml}
  </div>`;
  }).join('\n');
}

function renderEducation(education) {
  if (!Array.isArray(education) || education.length === 0) return '';
  return education.map(e => {
    const desc = e.description ? `<div class="edu-desc">${escapeHtml(e.description)}</div>` : '';
    return `
  <div class="edu-item">
    <div class="edu-header">
      <span class="edu-title">${escapeHtml(e.degree)} <span class="edu-org">— ${escapeHtml(e.institution)}</span></span>
      <span class="edu-year">${escapeHtml(e.period)}</span>
    </div>
    ${desc}
  </div>`;
  }).join('\n');
}

function renderSkills(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return '';
  return skills.map(s =>
    `  <div class="skill-item"><span class="skill-category">${escapeHtml(s.category)}:</span> ${escapeHtml(s.items)}</div>`
  ).join('\n');
}

// Combine experience + service for the Work Experience section. Service
// appears AFTER the regular experience entries (chronologically oldest).
const allExperience = [...tailored.experience, ...tailored.service];

const candidate = profileData.candidate || {};
const linkedinSlug = candidate.linkedin || '';
const linkedinUrl = linkedinSlug.startsWith('http') ? linkedinSlug : (linkedinSlug ? `https://${linkedinSlug}` : '');
const portfolio = candidate.portfolio_url || '';
const portfolioDisplay = portfolio.replace(/^https?:\/\//, '');

const vars = {
  LANG: 'en',
  PAGE_WIDTH: pageWidth,
  NAME: candidate.full_name || tailored.name || 'Candidate',
  PHONE: candidate.phone || '',
  EMAIL: candidate.email || '',
  LINKEDIN_URL: linkedinUrl,
  LINKEDIN_DISPLAY: linkedinSlug,
  PORTFOLIO_URL: portfolio,
  PORTFOLIO_DISPLAY: portfolioDisplay,
  LOCATION: candidate.location || '',
  SECTION_SUMMARY: 'Professional Summary',
  SUMMARY_TEXT: tailored.summary || '',
  SECTION_COMPETENCIES: 'Core Competencies',
  COMPETENCIES: renderCompetencies(tailored.competencies),
  SECTION_EXPERIENCE: 'Work Experience',
  EXPERIENCE: renderJobLike(allExperience),
  SECTION_PROJECTS: 'Projects',
  PROJECTS: '',  // cv.md has no Projects section; section gets stripped below
  SECTION_EDUCATION: 'Education',
  EDUCATION: renderEducation(tailored.education),
  SECTION_CERTIFICATIONS: 'Certifications',
  CERTIFICATIONS: '',  // cv.md has no Certifications section; stripped below
  SECTION_SKILLS: 'Skills',
  SKILLS: renderSkills(tailored.skills),
};

// Build the HTML
let html = template;

// Strip optional contact-row fields when empty (avoid orphan separators)
if (!vars.PORTFOLIO_URL || !vars.PORTFOLIO_URL.trim()) {
  html = html.replace(
    /<span class="separator">\|<\/span>\s*<a href="\{\{PORTFOLIO_URL\}\}">\{\{PORTFOLIO_DISPLAY\}\}<\/a>\s*/,
    ''
  );
}
if (!vars.PHONE || !vars.PHONE.trim()) {
  html = html.replace(
    /<span>\{\{PHONE\}\}<\/span>\s*<span class="separator">\|<\/span>\s*/,
    ''
  );
}

// Strip empty Projects + Certifications sections (no content in cv.md)
if (!vars.PROJECTS.trim()) {
  html = html.replace(
    /<!-- PROJECTS -->\s*<div class="section avoid-break">\s*<div class="section-title">\{\{SECTION_PROJECTS\}\}<\/div>\s*\{\{PROJECTS\}\}\s*<\/div>/,
    ''
  );
}
if (!vars.CERTIFICATIONS.trim()) {
  html = html.replace(
    /<!-- CERTIFICATIONS -->\s*<div class="section avoid-break">\s*<div class="section-title">\{\{SECTION_CERTIFICATIONS\}\}<\/div>\s*\{\{CERTIFICATIONS\}\}\s*<\/div>/,
    ''
  );
}

for (const [k, v] of Object.entries(vars)) {
  html = html.replaceAll(`{{${k}}}`, v);
}

// ---------------------------------------------------------------------------
// Write HTML + spawn PDF generator
// ---------------------------------------------------------------------------
mkdirSync(PATHS.output, { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const company = companyOverride || mods.company || 'unknown';
const companySlug = slugify(company);
const baseName = `cv-${companySlug}-${today}`;
const htmlPath = join(PATHS.output, `${baseName}.html`);
const pdfPath  = outputOverride || join(PATHS.output, `${baseName}.pdf`);

writeFileSync(htmlPath, html, 'utf-8');
console.log(`📝  HTML written: ${htmlPath}`);

if (dryRun) {
  console.log('\n(dry run — skipping PDF generation)');
  console.log(`\n  Company:   ${company}`);
  console.log(`  Role:      ${mods.role_title || 'unknown'}`);
  console.log(`  Archetype: ${mods.archetype || 'unknown'}`);
  console.log(`  Format:    ${pageFormat}`);
  console.log(`  HTML:      ${htmlPath}\n`);
  process.exit(0);
}

console.log(`🖨️   Spawning generate-pdf.mjs → ${pdfPath} (format: ${pageFormat})...`);

const child = spawn(
  'node',
  [PATHS.generatePdf, htmlPath, pdfPath, `--format=${pageFormat}`],
  { stdio: 'inherit' }
);

child.on('exit', (code) => {
  if (code !== 0) {
    console.error(`❌  PDF generation failed (exit code ${code}).`);
    process.exit(code);
  }
  if (!keepHtml) {
    try { unlinkSync(htmlPath); } catch { /* ignore */ }
  } else {
    console.log(`📝  HTML kept at: ${htmlPath}`);
  }
  console.log('\n' + '─'.repeat(66));
  console.log(`  Company:   ${company}`);
  console.log(`  Role:      ${mods.role_title || 'unknown'}`);
  console.log(`  Archetype: ${mods.archetype || 'unknown'}`);
  console.log(`  PDF:       ${pdfPath}`);
  console.log('─'.repeat(66) + '\n');
});

child.on('error', (err) => {
  console.error(`❌  Could not spawn generate-pdf.mjs: ${err.message}`);
  process.exit(1);
});

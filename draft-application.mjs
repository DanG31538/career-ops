#!/usr/bin/env node
/**
 * draft-application.mjs — Cover letter + custom question drafter
 *
 * Two modes, picked by CLI args:
 *   - Cover letter only (default — no extra flags)
 *   - Cover letter + question answers (when --questions or --questions-file is passed)
 *
 * Architecture mirrors tailor-cv.mjs:
 *   1. Parse cv.md deterministically (via lib/parse-cv.mjs)
 *   2. Send parsed CV + JD + optional question text to LLM
 *   3. LLM returns JSON with cover_letter + (optionally) answers[]
 *   4. Render JSON as a single markdown file in output/
 *
 * Truthfulness: every claim must trace to cv.md or profile.yml.
 * Tone: professional, direct, no corporate filler.
 *
 * Usage:
 *   node draft-application.mjs --file jds/test-1.txt
 *   node draft-application.mjs --file jds/test-1.txt --questions "Q1...\nQ2..."
 *   node draft-application.mjs --file jds/test-1.txt --questions-file ./q.txt
 *   node draft-application.mjs --file jds/test-1.txt --company Acme
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
  output:     join(ROOT, 'output'),
};

// ---------------------------------------------------------------------------
// Provider resolution (same as llm-eval.mjs / tailor-cv.mjs)
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
║  career-ops — Application Drafter (cover letter + Q&A)           ║
╚══════════════════════════════════════════════════════════════════╝

  Drafts a cover letter (and optional custom question answers) grounded
  in cv.md, tailored to the specific JD. Every claim traces to your CV.

  USAGE
    node draft-application.mjs --file jds/test-1.txt
    node draft-application.mjs --file jds/test-1.txt \\
      --personal "I grew up watching Paramount films; ML for media I love is rare"
    node draft-application.mjs --file jds/test-1.txt --questions-file ./q.txt

  OPTIONS
    --file <path>             Read JD from a file
    --personal "..."          Your personal/genuine connection to THIS company
                              (used in cover letter ¶1 hook — without this the
                              letter sounds like a resume recap, which is what
                              cover letters are supposed to NOT be)
    --personal-file <path>    Read personal context from a file
    --questions "..."         Inline application questions (newline-separated)
    --questions-file <path>   Read questions from a file
    --model <name>            Override LLM_MODEL
    --max-tokens <n>          Output token budget (default 4096)
    --company <name>          Override company name (used for filename)
    --output <path>           Override output markdown path
    --help                    Show this help

  TONE GUARANTEES
    No "I'm passionate about", "excited to", "looking forward to" filler.
    No invented metrics. Every claim traces to cv.md.
    With --personal: ¶1 leads with the human layer (your connection to
    the company) before bridging to the professional fit.
`);
  process.exit(0);
}

let jdText = '';
let questionsText = '';
let personalText = '';
let modelOverride = null;
let maxTokens = parseInt(process.env.LLM_MAX_TOKENS || '4096', 10);
let companyOverride = null;
let outputOverride = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--file' && args[i + 1]) {
    const fp = args[++i];
    if (!existsSync(fp)) { console.error(`❌  File not found: ${fp}`); process.exit(1); }
    jdText = readFileSync(fp, 'utf-8').trim();
  } else if (a === '--questions' && args[i + 1]) {
    questionsText = args[++i];
  } else if (a === '--questions-file' && args[i + 1]) {
    const fp = args[++i];
    if (!existsSync(fp)) { console.error(`❌  Questions file not found: ${fp}`); process.exit(1); }
    questionsText = readFileSync(fp, 'utf-8').trim();
  } else if (a === '--personal' && args[i + 1]) {
    personalText = args[++i];
  } else if (a === '--personal-file' && args[i + 1]) {
    const fp = args[++i];
    if (!existsSync(fp)) { console.error(`❌  Personal context file not found: ${fp}`); process.exit(1); }
    personalText = readFileSync(fp, 'utf-8').trim();
  } else if (a === '--model' && args[i + 1]) {
    modelOverride = args[++i];
  } else if (a === '--max-tokens' && args[i + 1]) {
    maxTokens = parseInt(args[++i], 10);
    if (isNaN(maxTokens) || maxTokens <= 0) { console.error(`❌  Invalid --max-tokens`); process.exit(1); }
  } else if (a === '--company' && args[i + 1]) {
    companyOverride = args[++i];
  } else if (a === '--output' && args[i + 1]) {
    outputOverride = args[++i];
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
const hasQuestions = questionsText.trim().length > 0;
const hasPersonal  = personalText.trim().length > 0;

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

// Tiny YAML reader (same shape as in tailor-cv.mjs — only for contact fields)
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

// ---------------------------------------------------------------------------
// Load + parse context
// ---------------------------------------------------------------------------
console.log('\n📂  Loading and parsing context...');

const cvRaw = readFileOrEmpty(PATHS.cv, 'cv.md');
if (!cvRaw.trim()) {
  console.error('❌  cv.md is empty or missing — nothing to ground answers in.');
  process.exit(1);
}
const cv = parseCv(cvRaw);

console.log(`   Experience: ${cv.experience.length} entries (${cv.experience.map(e => e.id).join(', ')})`);
console.log(`   Service:    ${cv.service.length} entries`);
console.log(`   Skills:     ${cv.skills.length} categories`);
if (hasQuestions) console.log(`   Questions:  ${questionsText.split('\n').filter(l => l.trim()).length} lines detected`);
if (hasPersonal)  console.log(`   Personal:   ${personalText.split(/\s+/).filter(Boolean).length} words of context provided`);
else              console.log(`   Personal:   none — cover letter will use professional-fit-only hook (consider passing --personal "..." for a stronger letter)`);

const profileMd      = readFileOrEmpty(PATHS.profile,    'modes/_profile.md');
const profileYmlRaw  = readFileOrEmpty(PATHS.profileYml, 'config/profile.yml');
const profileData    = readProfileYml(PATHS.profileYml);

// ---------------------------------------------------------------------------
// Build the LLM prompt
// ---------------------------------------------------------------------------
// Strip the description from service entries that have bullets, to keep the
// context lean (we send the full prose only when there are no bullets).
const cvForLLM = {
  name: cv.name,
  summary: cv.summary,
  experience: cv.experience,
  service: cv.service,
  education: cv.education,
  skills: cv.skills,
};

const outputContract = hasQuestions
  ? `Return a single JSON object:
{
  "company": "Detected company name from JD",
  "role_title": "Detected role title from JD",
  "archetype": "Detected archetype",
  "cover_letter": "Full 3-paragraph cover letter as plain markdown (no code fences). Use a proper salutation like 'Dear Acme Hiring Team,' and a sign-off with the candidate's name from the parsed CV.",
  "answers": [
    {
      "question": "exact question text as the candidate would see it on the form",
      "answer": "draft answer — STAR+R for behavioral, 2-3 sentences for short-answer. Every claim grounded in parsed CV."
    }
    // ... one entry per question detected in the input
  ]
}`
  : `Return a single JSON object:
{
  "company": "Detected company name from JD",
  "role_title": "Detected role title from JD",
  "archetype": "Detected archetype",
  "cover_letter": "Full 3-paragraph cover letter as plain markdown (no code fences). Use a proper salutation like 'Dear Acme Hiring Team,' and a sign-off with the candidate's name from the parsed CV."
}`;

const systemPrompt = `You are career-ops Application Drafter. You produce application materials
grounded in the candidate's actual experience (the parsed CV below), tailored
for the specific JD.

═══════════════════════════════════════════════════════
TRUTHFULNESS — NON-NEGOTIABLE
═══════════════════════════════════════════════════════
Every claim, metric, project, or specific accomplishment in your output MUST
trace back to the parsed CV. You may rephrase or condense. You may NOT invent
new facts, scale up numbers, or add experience the candidate doesn't have.

═══════════════════════════════════════════════════════
TONE
═══════════════════════════════════════════════════════
- Professional, direct, conversational
- Active voice, concrete verbs
- NO filler: "I'm passionate about", "I'm excited to", "I look forward to",
  "thrilled at the opportunity", "as a results-driven", etc.
- NO empty superlatives ("world-class", "cutting-edge", "rockstar")
- NO corporate-speak buzzwords as decoration
- It IS okay to mention the specific company by name in the cover letter
  (it's addressed to them); just don't gush

═══════════════════════════════════════════════════════
COVER LETTER STRUCTURE (always produced)
═══════════════════════════════════════════════════════

CRITICAL: The cover letter is NOT a resume recap. The resume is attached
and already contains the metrics, accomplishments, projects, technologies,
and job-by-job detail. The cover letter exists ONLY to convey what the
resume cannot:
  ¶1: WHY this specific candidate wants to work at THIS specific company
      (the human layer — personal connection to the company/product)
  ¶2: WHAT it would mean to combine the candidate's ML expertise with
      THIS company's work (the synthesis — forward-looking, reflective)
  ¶3: That the candidate is ready and genuinely interested

ABSOLUTE RULE: Do NOT list specific accomplishments, metrics, or named
projects from the resume in the body of the cover letter. References to
the candidate's background must be GENERIC and forward-looking ("the
production ML I've been building", "the years I've spent on multi-modal
systems", "the craft I've applied at enterprise scale"). Never recap
("At PNC I built X achieving Q% efficiency..."). The resume is attached;
trust the reader to read it.

Three paragraphs, ~80-120 words each, ~250-330 words total. Use a proper
salutation ("Dear [Company] Hiring Team,") and sign off with the
candidate's full name from the parsed CV.

══════════════════════════════════════════════════════
VOICE & REGISTER — read this BEFORE the paragraph rules
══════════════════════════════════════════════════════
The letter must sound like a sharp engineer explaining why they're a good
fit to a respected colleague over coffee — NOT like a candidate addressing
a hiring committee. The register difference is the whole letter.

CAPABLE / HEADSTRONG / MOTIVATED / EMOTIONAL UNDERTONE — these are the
four dimensions. The candidate states things confidently, treats the
reader as a peer, never hedges, never performs enthusiasm, and lets the
emotion come through in WHAT they choose to say rather than declaring it.

The PERSONAL CONTEXT block from the user message is the FOUNDATION of
the entire letter — not just ¶1's opener. ¶2 should build the synthesis
directly from the values surfaced in ¶1. ¶3 should close back to the
same human voice. The letter is one continuous arc anchored in the
personal context, not three disconnected sections.

══════ Peer voice (what we want) ══════
  - Direct. Short sentences. Fragments OK for emphasis.
  - Contractions: I've, I'm, they're, it's, that's.
  - States things — no "I think", "I believe", "I feel"
  - Treats reader as a smart peer who doesn't need over-explanation
  - Confidence without bragging — facts not performance
  - Real stakes shown through what the candidate VALUES
  - Light wit / dry humor allowed
  - Vulnerability allowed (admitting what's rare or hard to find)
  - Occasional sentence fragment hits harder than a full sentence

══════ Applicant voice (what we DON'T want) ══════
  - Hedges: "I'd genuinely love to", "I would welcome the opportunity",
    "If any of this resonates", "Should you find this of interest",
    "I'd be happy to"
  - Softeners: "I think", "I believe", "I feel", "perhaps"
  - Performance: "I am passionate about", "I am excited about", "I am
    thrilled", "I am eager to", "I love", "this would be a dream"
  - Deference: "Thank you for your consideration", "I appreciate your
    time", "I look forward to hearing from you"
  - Over-writing: "the kind of work I want to bring everything I've
    learned about shipping multi-modal systems to" → just say "that's
    the work I want"

══════ Sentence-level rewrites (soft → sharp) ══════

  Soft: "I would genuinely love to discuss this opportunity further."
  Sharp: "Available immediately. Email's at the top — reach out if
         you want to talk."

  Soft: "I am drawn to Paramount because of the company's incredible
         legacy in entertainment and the opportunity to apply my ML
         expertise."
  Sharp: "I grew up on Paramount — Mission Impossible got me through
         adolescence, the original Star Trek shaped how I think about
         technology. Most ML jobs in my pipeline are adjacent to
         products I have a transactional relationship with. Paramount
         makes the product."

  Soft: "This role aligns well with my background in production ML."
  Sharp: "The production ML craft is the same as where I've been.
         The stakes change when the product is something you'd buy
         a ticket for."

  Soft: "I'd love to bring my passion for ML to your team."
  Sharp: "I want to be deep in this work."

  Soft: "Thank you for considering my application."
  Sharp: (omit entirely — no boilerplate sign-offs)

══════ Emotional undertone — show, don't declare ══════
The candidate shows they care through SUBSTANCE, not declaration:
  - Naming specific products, specific kinds of work, specific reasons
    one role is rare among many
  - Talking about what they want to be doing for the next chapter
  - Admitting when something is hard to find or rare
  - Showing they have opinions and stakes — "that's the work" carries
    more emotion than "I'm passionate about this work"

The candidate NEVER says: "I'm passionate", "I'm excited", "I love",
"this would be a dream", "an amazing opportunity", "thrilled to apply".

──────────────────────────────────────────────────────
¶1 RELATION TO THE COMPANY / PRODUCT  (3-4 sentences)
──────────────────────────────────────────────────────
What is THIS candidate's HUMAN connection to THIS specific company or
its work? This paragraph is ENTIRELY about the personal/human layer —
no professional credentials, no JD mapping, no career history.

Pull entirely from the PERSONAL CONTEXT block in the user message.
The paragraph must:
  - Be specific to the candidate (memories, products consumed, life
    patterns, family context, values actually held)
  - Be specific to the company (named products, content, work, mission
    as the candidate experiences it)
  - Sound like a real human voice — colloquial, occasionally vulnerable,
    never press-release
  - STOP cleanly before any career/credentials/JD content — that's
    ¶2's job

DO NOT in ¶1:
  - Mention employers, accomplishments, or job titles from the resume
  - Reference JD requirements or technical themes
  - Use phrases like "Your JD's focus on..." or "this role's emphasis"
  - Use empty motivation: "I'm drawn to...", "I'm excited about...",
    "I'm passionate about...", "I have long admired..."

GOOD example (PERSONAL CONTEXT about Paramount films/shows):
  "I grew up on Paramount. The Mission Impossible series carried me
   through adolescence, the original Star Trek shaped how I think
   about technology and ambition, and Yellowstone has been my
   Sunday-night ritual the last few years. Most companies I look at
   sell software for someone else's product — something I have a
   transactional relationship with at best. Paramount makes the
   content itself."

GOOD example (PERSONAL CONTEXT about Guard family lineage):
  "I served as a National Guard sergeant from 2015 to 2021, and my
   father served before me. The work [Company] does sits squarely in
   the world I grew up in and the world I served in. That's not the
   abstract domain it is for most candidates — it's the air I've
   breathed for most of my adult life."

NOTICE: both examples are PURELY personal. No mention of ML work, no
career claims, no JD-mapping. They STOP before bridging.

If NO personal context was provided:
  Write a thinner ¶1 that's honest about the candidate noticing the
  role and being interested in the role pattern (not the specific
  company they don't have context for). Keep it brief and don't fake
  enthusiasm. Then ¶2 carries more of the weight.

──────────────────────────────────────────────────────
¶2 THE SYNTHESIS  (3-5 sentences)
──────────────────────────────────────────────────────
What would it MEAN for THIS candidate to combine their ML expertise
with THIS company's work? Forward-looking and reflective. This is NOT
a place to list accomplishments — the resume has those.

Reference the candidate's ML background ONLY in generic, forward-looking
phrases:
  - "the production ML I've been building"
  - "the years I've spent on multi-modal systems"
  - "the MLOps craft I've developed"
  - "the same engineering discipline I've been applying at enterprise scale"
  - "what I've spent my career on"

NEVER in ¶2 use:
  - Specific named employers from the candidate's resume (no "at PNC",
    no "at Four Growers" — those belong in the resume, not the cover
    letter body)
  - Specific metrics (no "60%", no "\$5.3M", no "20,000 images")
  - Specific named projects (no "RAG chatbot", no "Mask R-CNN", no
    "Kubeflow pipeline", no "Inception-ResNet")
  - JD-mapping language ("Your JD's focus on...", "this role's
    emphasis on...", "the requirements you describe")

The paragraph should articulate:
  - What doing THIS work at THIS company would mean to the candidate
  - What's unique or rare about the synthesis (personal stake +
    technical capability combined)
  - Why the company's specific domain makes the work matter to them

GOOD example (Paramount, building on the ¶1 above):
  "Recommendation and content-understanding for media I actually
   watch — that's the kind of problem I want to be deep in. The
   production ML craft is the same as everywhere else. The stakes
   change when you're making sure the right person finds something
   they'd love. That's the work."

GOOD example (defense, building on the ¶1 above):
  "Production ML for a domain I already understand operationally is
   the synthesis I've been waiting for. Most ML jobs ask me to learn
   the domain after the fact. This one doesn't — and the work
   matters in a way other applications of the same skills don't."

What makes these sharp: short sentences, fragments where they hit,
no "I'd love to bring everything I've learned about...", no rare-
opportunity self-awareness, no over-explaining. State things.

NOTICE: zero specific metrics. Zero named employers from the resume.
Zero JD-mapping. Pure reflection on the synthesis.

──────────────────────────────────────────────────────
¶3 READY + INTEREST  (2-3 sentences)
──────────────────────────────────────────────────────
Short, direct, warm. Convey:
  - Availability (pull from profile.yml current_status — for an
    unemployed / open-to-work candidate, use "available immediately"
    or "ready to start right away")
  - Genuine interest in talking further about THIS role/company
  - Easy reach (contact info is in the header — just gesture at it,
    don't restate it)

"Looking forward to" is OK ONLY when it expresses anticipation of the
WORK or the CONVERSATION ("I'm looking forward to talking about this
work") — NEVER as a sign-off filler ("Looking forward to hearing from
you").

GOOD examples (open-to-work candidate — note the peer voice, no hedging):
  - "Available immediately. Email's at the top — reach out if you
     want to talk through any of this."
  - "Ready to start. If this is moving forward, contact info's in
     the header."
  - "Available now. Happy to dig into the work in a call when you're
     ready."
  - "I'm available immediately. Reach out when you want to talk."

What makes these sharp: no "I'd love to", no "I would welcome", no
"if any of this resonates", no "genuinely". Just facts + an open
door, peer to peer.

DO NOT:
  - Invent a notice period not supported by profile.yml
  - Use "Looking forward to hearing from you" as a sign-off
  - Use "I would welcome the opportunity..." filler
  - Use "Thank you for your consideration" boilerplate

──────────────────────────────────────────────────────
FORBIDDEN PHRASES (apply to ALL paragraphs)
──────────────────────────────────────────────────────
  - "Your JD's focus on..." / "This role's emphasis on..."
  - "Your JD describes..." / "Your role calls for..."
  - "I see that you..." / "I noticed your..."
  - "I'm drawn to..." / "I'm excited about the opportunity to..."
  - "I'm passionate about..." / "I have long admired..."
  - "Your team's mission to..." / "Your company's commitment to..."
  - "What attracts me to this position is..."
  - Any specific metric from the resume (60%, \$5.3M, 20,000, 40%, etc.)
  - Any specific project name from the resume (RAG chatbot, Mask R-CNN
    tomato-picker, Kubeflow pipeline, Inception-ResNet, etc.)
  - Any specific named employer in ¶2 or ¶3 (PNC, Four Growers, CMU,
    LLNL — they belong in the resume, not the cover letter body)
  - "Looking forward to hearing from you" / "I would welcome the
    opportunity to..." / "Thank you for your consideration"

${hasQuestions ? `═══════════════════════════════════════════════════════
CUSTOM QUESTION ANSWERS (produced when questions are provided)
═══════════════════════════════════════════════════════
For each question in the input questions block:
  - If behavioral ("Tell us about a time...", "Describe a situation..."),
    use STAR+R format inline:
      * Situation: one sentence of context
      * Task: what the candidate needed to do
      * Action: what they did (verbs, specifics)
      * Result: measurable outcome from cv.md
      * Reflection: one sentence on what was learned or how it generalizes
  - If short-answer ("Why this role?", "What's your salary expectation?"),
    write 2-3 concise sentences
  - If yes/no with explanation ("Do you require visa sponsorship?"),
    pull the answer from profile.yml (US citizen, no sponsorship needed)
  - If location/availability ("Where are you based?"), pull from profile.yml

Detect the questions from free-form text — they may be numbered, bulleted,
or just newline-separated. Identify each distinct question and answer it.
` : ''}═══════════════════════════════════════════════════════
PARSED CV (canonical — your only source of truth for the candidate)
═══════════════════════════════════════════════════════
${JSON.stringify(cvForLLM, null, 2)}

═══════════════════════════════════════════════════════
CANDIDATE PROFILE & PREFERENCES (config/profile.yml)
═══════════════════════════════════════════════════════
${profileYmlRaw}

═══════════════════════════════════════════════════════
ARCHETYPES + ADAPTIVE FRAMING (modes/_profile.md)
═══════════════════════════════════════════════════════
${profileMd}

═══════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════
${outputContract}

NO PROSE BEFORE OR AFTER THE JSON. NO MARKDOWN FENCES.
`;

let userMessage = `JOB DESCRIPTION:\n\n${jdText}`;
if (hasPersonal) {
  userMessage += `\n\n═══════════════════════════════════════\n\nPERSONAL CONTEXT (candidate-provided — use this to drive the ¶1 hook):\n\n${personalText}`;
}
if (hasQuestions) {
  userMessage += `\n\n═══════════════════════════════════════\n\nAPPLICATION QUESTIONS:\n\n${questionsText}`;
}

// ---------------------------------------------------------------------------
// Call LLM
// ---------------------------------------------------------------------------
console.log(`🤖  Calling ${providerConfig.provider} (${modelName})...`);

const client = new OpenAI({ apiKey: providerConfig.apiKey, baseURL: providerConfig.baseUrl });

async function callOnce(extra = '') {
  const sys = extra ? systemPrompt + '\n\n' + extra : systemPrompt;
  const completion = await client.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: sys },
      { role: 'user',   content: userMessage },
    ],
    temperature: 0.5,  // a touch higher than tailor — cover letters benefit from voice
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
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

let raw, result;
try {
  raw = await callOnce();
  const json = extractJsonObject(raw);
  if (!json) throw new Error('No JSON object in response');
  result = JSON.parse(json);
} catch (err) {
  console.warn(`⚠️   First attempt failed (${err.message}). Retrying with stricter prompt...`);
  try {
    raw = await callOnce('CRITICAL: previous response did not parse. Return ONLY the JSON object — no prose, no fences, no leading or trailing text.');
    const json = extractJsonObject(raw);
    if (!json) throw new Error('No JSON object in retry response');
    result = JSON.parse(json);
  } catch (err2) {
    const sanitized = (err2.message || '').split(providerConfig.apiKey).join('[REDACTED]');
    console.error(`❌  Failed to parse JSON after retry: ${sanitized}`);
    mkdirSync(PATHS.output, { recursive: true });
    const dumpPath = join(PATHS.output, `_draft-debug-${Date.now()}.txt`);
    writeFileSync(dumpPath, raw, 'utf-8');
    console.error(`    Raw response dumped to: ${dumpPath}`);
    process.exit(1);
  }
}

console.log(`✅  Draft received (company: ${result.company || 'unknown'}, archetype: ${result.archetype || 'unknown'}).`);
if (hasQuestions && Array.isArray(result.answers)) {
  console.log(`   Answers drafted: ${result.answers.length}`);
}

// ---------------------------------------------------------------------------
// Render output markdown
// ---------------------------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
const company = companyOverride || result.company || 'unknown';
const companySlug = slugify(company);

mkdirSync(PATHS.output, { recursive: true });

const outPath = outputOverride || join(PATHS.output, `application-${companySlug}-${today}.md`);

const headerBlock = `# Application Draft — ${company}${result.role_title ? ` · ${result.role_title}` : ''}

*Drafted ${today} · review before sending. Every claim should trace to your CV — verify before submitting.*

`;

const coverBlock = `## Cover Letter\n\n${(result.cover_letter || '').trim()}\n`;

let answersBlock = '';
if (hasQuestions && Array.isArray(result.answers) && result.answers.length) {
  answersBlock = `\n---\n\n## Application Questions\n\n`;
  result.answers.forEach((qa, i) => {
    const q = (qa.question || `Question ${i + 1}`).trim();
    const a = (qa.answer || '(no draft provided)').trim();
    answersBlock += `### Q${i + 1}. ${q}\n\n${a}\n\n`;
  });
}

const markdown = headerBlock + coverBlock + answersBlock;
writeFileSync(outPath, markdown, 'utf-8');

console.log('\n' + '─'.repeat(66));
console.log(`  Company:   ${company}`);
console.log(`  Role:      ${result.role_title || 'unknown'}`);
console.log(`  Archetype: ${result.archetype || 'unknown'}`);
console.log(`  Output:    ${outPath}`);
console.log('─'.repeat(66) + '\n');

/**
 * lib/parse-report.mjs — Parse the header of a report markdown file.
 *
 * Reports are written by llm-eval.mjs in this shape:
 *
 *   # Evaluation: {company} — {role}
 *
 *   **Date:** 2026-05-28
 *   **Archetype:** AI Research Engineer
 *   **Score:** 3.0/5
 *   **Legitimacy:** Proceed with Caution
 *   **URL:** https://...           (optional)
 *   **PDF:** pending|<path>
 *   **Tool:** openrouter (meta-llama/llama-3.3-70b-instruct)
 *   **Batch ID:** 010              (optional)
 *
 *   ---
 *
 *   <body — repeated header + sections A-G from the LLM>
 *
 * Parser is tolerant: missing fields become null. We only look at the
 * lines above the first `---` separator, so the LLM's body content
 * never confuses us.
 */

import { readFileSync, existsSync } from 'fs';

const EM_DASH = '—';
const HEADER_FIELDS = ['Date', 'Archetype', 'Score', 'Legitimacy', 'URL', 'PDF', 'Tool', 'Batch ID'];

/**
 * Parse a report file at the given path.
 * Returns { file, company, role, score, ...HEADER_FIELDS } or null if the file
 * doesn't exist or doesn't have a parseable title line.
 *
 * `score` is normalized to a Number (e.g. "3.0/5" → 3.0). Returns null
 * for the score if it can't be parsed.
 */
export function parseReport(filePath) {
  if (!existsSync(filePath)) return null;
  const text = readFileSync(filePath, 'utf-8');
  return parseReportText(text, filePath);
}

export function parseReportText(text, filePath = null) {
  // Header lives above the first `---` line (which separates llm-eval's
  // metadata block from the LLM's actual evaluation body).
  const sepIdx = text.indexOf('\n---');
  const headerBlock = sepIdx === -1 ? text : text.slice(0, sepIdx);
  const lines = headerBlock.split('\n').map(l => l.replace(/\r$/, ''));

  // Title: # Evaluation: {company} — {role}
  let company = null, role = null;
  for (const line of lines) {
    const m = line.match(/^#\s+Evaluation:\s+(.+)$/);
    if (m) {
      const rest = m[1].trim();
      // Split on em-dash (preferred) or hyphen-with-spaces as fallback
      const split = rest.split(` ${EM_DASH} `);
      if (split.length >= 2) {
        company = split[0].trim();
        role = split.slice(1).join(` ${EM_DASH} `).trim();
      } else {
        // Fallback: try " - " (ASCII hyphen)
        const alt = rest.split(' - ');
        if (alt.length >= 2) {
          company = alt[0].trim();
          role = alt.slice(1).join(' - ').trim();
        } else {
          company = rest;
          role = null;
        }
      }
      break;
    }
  }

  // Bold-labeled fields: **Field:** value
  const fields = {};
  for (const line of lines) {
    const m = line.match(/^\*\*([^*]+?):\*\*\s*(.*?)\s*$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }

  // Normalize Score "3.0/5" → 3.0 (or null).
  // IMPORTANT: anchored at start so "?/5" doesn't parse as 5.0. When llm-eval
  // can't extract the score from the LLM output, it writes "?/5" as a sentinel;
  // an unanchored regex would match the "5" from the "/5" suffix and silently
  // promote a failed eval to a phantom top score.
  let score = null;
  if (fields['Score']) {
    const sm = fields['Score'].match(/^(\d+(?:\.\d+)?)/);
    if (sm) {
      const parsed = parseFloat(sm[1]);
      if (!isNaN(parsed)) score = parsed;
    }
  }

  // Normalize PDF: "pending" → null, otherwise keep as-is
  let pdf = fields['PDF'] || null;
  if (pdf && pdf.toLowerCase() === 'pending') pdf = null;

  return {
    file: filePath,
    company,
    role,
    score,
    date:        fields['Date']       || null,
    archetype:   fields['Archetype']  || null,
    legitimacy:  fields['Legitimacy'] || null,
    url:         fields['URL']        || null,
    pdf,
    tool:        fields['Tool']       || null,
    batchId:     fields['Batch ID']   || null,
  };
}

/**
 * Lightweight predicate: is this a parseable report file with a numeric score?
 */
export function isValidReport(report) {
  return report && report.company && typeof report.score === 'number';
}

/**
 * lib/obsidian-note.mjs — Write/update Obsidian notes for decided evaluations
 *
 * Each decided evaluation (decision: 'applied' | 'discarded') becomes one
 * markdown note in $OBSIDIAN_VAULT_PATH/applications/. The note is the
 * Obsidian-friendly human view of an application: structured frontmatter for
 * Dataview queries + readable sections for browsing.
 *
 * Behavior:
 *   - If $OBSIDIAN_VAULT_PATH is unset, this is a no-op (graceful degradation;
 *     bot still runs fine on machines without Obsidian).
 *   - First write for a report: creates the full note (frontmatter + body).
 *   - Subsequent writes for the same report: appends a dated line to the
 *     "## Activity log" section only. Never rewrites the body or touches
 *     the user-owned "## Notes" section.
 *
 * Zoning (critical for Syncthing conflict safety):
 *   Bot writes:    frontmatter (rewrite), Job posting / Eval snapshot /
 *                  Application materials (rewrite on create only),
 *                  Activity log (append-only after create).
 *   User writes:   ## Notes (bot never reads or writes this section).
 *
 * Why this zoning: Syncthing creates conflict files when two writers touch
 * the same byte range. Confining bot writes to its own sections lets Dan
 * edit ## Notes freely without ever conflicting with bot output.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// ---------------------------------------------------------------------------
// Vault resolution
// ---------------------------------------------------------------------------
function vaultPath() {
  const p = process.env.OBSIDIAN_VAULT_PATH;
  if (!p || !p.trim()) return null;
  return p.trim();
}

function applicationsDir() {
  const v = vaultPath();
  if (!v) return null;
  return join(v, 'applications');
}

// ---------------------------------------------------------------------------
// Filename / slug helpers
// ---------------------------------------------------------------------------
function slugify(s, max = 50) {
  return (s || 'unknown').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max) || 'unknown';
}

/**
 * Note filename: {decision_date}-{batchId}-{company-slug}-{role-slug}.md
 * e.g. 2026-05-31-020-hightouch-head-of-machine-learning.md
 *
 * The batchId is included so two decisions on different reports never collide
 * on filename (e.g. two "unknown — unknown" reports from the pre-fix
 * SCORE_SUMMARY bug would otherwise overwrite each other). The leading date
 * keeps the folder naturally sorted by decision time.
 */
function noteFilename(report, decisionDate) {
  const date = decisionDate || new Date().toISOString().slice(0, 10);
  const batch = report.batchId || '000';
  const co  = slugify(report.company, 30);
  const role = slugify(report.role, 60);
  return `${date}-${batch}-${co}-${role}.md`;
}

// ---------------------------------------------------------------------------
// Markdown templating
// ---------------------------------------------------------------------------
const FRONTMATTER_END = '---\n';
const SECTION_NOTES = '## Notes';

/**
 * Compute follow-up due date: decision_date + 7 days. ISO date string.
 */
function followupDueDate(decisionDate) {
  const d = new Date(decisionDate);
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function buildFrontmatter({ report, posted, decision, decisionDate }) {
  return {
    // === Identity ===
    company: report.company || 'unknown',
    role:    report.role    || 'unknown',
    url:     report.url     || null,

    // === Eval ===
    archetype:   report.archetype  || null,
    score:       report.score      ?? null,
    legitimacy:  report.legitimacy || null,
    eval_date:   report.date       || null,
    report_file: report.file ? report.file.split(/[\\/]/).pop() : null,

    // === Application ===
    status:             decision,                          // 'applied' | 'discarded'
    decision_date:      decisionDate,
    cover_letter_file:  null,   // filled by future hook when draft is generated
    cv_file:            posted?.pdfPath ? posted.pdfPath.split(/[\\/]/).pop() : null,
    followup_due:       decision === 'applied' ? followupDueDate(decisionDate) : null,

    // === Discord trace ===
    discord_message_id: posted?.messageId || null,
    discord_channel_id: posted?.channelId || null,
    discord_guild_id:   posted?.guildId   || null,

    tags:     [],
    contacts: [],
  };
}

function renderNote({ report, posted, decision, decisionDate }) {
  const fm = buildFrontmatter({ report, posted, decision, decisionDate });
  const fmYaml = yaml.dump(fm, { quotingType: '"', forceQuotes: false, lineWidth: -1 });

  const scoreStr = report.score != null ? report.score.toFixed(1) : '?';
  const reportFilename = report.file ? report.file.split(/[\\/]/).pop() : null;
  const pdfFilename    = posted?.pdfPath ? posted.pdfPath.split(/[\\/]/).pop() : null;

  const urlLine = report.url ? `[Apply on ATS](${report.url})` : '_(no URL recorded)_';
  const reportLine = reportFilename ? `- Full report: \`reports/${reportFilename}\`\n` : '';
  const pdfLine = pdfFilename ? `- Resume: \`${pdfFilename}\`` : '- Resume: _(not generated)_';

  const evalLine = report.date
    ? `- ${report.date} — Evaluated (${scoreStr}/5, ${report.legitimacy || 'unknown legitimacy'})`
    : `- (date unknown) — Evaluated`;
  const decisionVerb = decision === 'applied' ? 'Applied (via Discord ✅)' : 'Discarded (via Discord ❌)';
  const decisionLine = `- ${decisionDate} — ${decisionVerb}`;

  return `---
${fmYaml.trimEnd()}
---

# ${report.company || 'Unknown'} — ${report.role || 'Unknown'}

## Job posting

${urlLine}

## Eval snapshot

- Score: **${scoreStr}/5** (${report.legitimacy || 'unknown'})
- Archetype: ${report.archetype || 'unknown'}
${reportLine}
## Application materials

${pdfLine}
- Cover letter: _(see output/application-*.md if drafted)_

## Activity log

<!-- Bot-managed. Append-only; bot never modifies prior lines. -->
${evalLine}
${decisionLine}

${SECTION_NOTES}

<!-- Your space. The bot never reads or writes anything below this line. -->
`;
}

// ---------------------------------------------------------------------------
// Append-only update path
// ---------------------------------------------------------------------------
/**
 * Append a dated line to the existing note's ## Activity log section.
 * Returns true if appended, false if the section couldn't be found (e.g. the
 * note was hand-edited and the section header is missing).
 *
 * We split the file on the "## Notes" line (the hands-off zone) so we never
 * disturb anything below it. The activity log line is inserted between the
 * last line of ## Activity log and the blank line before ## Notes.
 */
export function appendActivity(notePath, line) {
  if (!existsSync(notePath)) return false;
  const text = readFileSync(notePath, 'utf-8');

  const notesIdx = text.indexOf(`\n${SECTION_NOTES}`);
  if (notesIdx === -1) return false;

  const beforeNotes = text.slice(0, notesIdx);
  const fromNotes   = text.slice(notesIdx);

  // Find the activity log header inside beforeNotes
  const logHeader = '## Activity log';
  const logIdx = beforeNotes.lastIndexOf(logHeader);
  if (logIdx === -1) return false;

  // Insert before the trailing blank line in beforeNotes
  const trimmed = beforeNotes.replace(/\n+$/, '');
  const newContent = `${trimmed}\n- ${line}\n${fromNotes}`;
  writeFileSync(notePath, newContent, 'utf-8');
  return true;
}

// ---------------------------------------------------------------------------
// Public API: create-or-append note for a decision
// ---------------------------------------------------------------------------
/**
 * Called by the bot when markDecision flips a report's decision to a
 * non-null value. Creates the note if missing, otherwise appends to the
 * activity log.
 *
 *   ctx: {
 *     report:       parsed report object (from lib/parse-report.mjs)
 *     posted:       state.posted[reportFile] entry (for Discord IDs, pdfPath)
 *     decision:     'applied' | 'discarded'
 *     decisionDate: ISO yyyy-mm-dd
 *   }
 *
 * Returns:
 *   - { written: 'created', path } when the note was newly created
 *   - { written: 'appended', path } when only the activity log was updated
 *   - { written: 'skipped', reason } when OBSIDIAN_VAULT_PATH is unset or
 *     required fields are missing
 *   - { written: 'failed', reason } on I/O error (caller decides whether to
 *     break the parent flow — usually best-effort, log and move on)
 */
export function writeNoteForDecision(ctx) {
  const dir = applicationsDir();
  if (!dir) return { written: 'skipped', reason: 'OBSIDIAN_VAULT_PATH unset' };
  if (!ctx.report || !ctx.decision || !ctx.decisionDate) {
    return { written: 'skipped', reason: 'missing required field' };
  }

  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    return { written: 'failed', reason: `mkdir: ${err.message}` };
  }

  const filename = noteFilename(ctx.report, ctx.decisionDate);
  const fullPath = join(dir, filename);

  if (existsSync(fullPath)) {
    // Note already exists — append a status-change line to the activity log.
    const verb = ctx.decision === 'applied' ? 'Applied (via Discord ✅)' : 'Discarded (via Discord ❌)';
    const line = `${ctx.decisionDate} — ${verb}`;
    const ok = appendActivity(fullPath, line);
    return ok
      ? { written: 'appended', path: fullPath }
      : { written: 'failed', reason: 'could not locate ## Activity log section' };
  }

  // Create the full note.
  try {
    const content = renderNote(ctx);
    writeFileSync(fullPath, content, 'utf-8');
    return { written: 'created', path: fullPath };
  } catch (err) {
    return { written: 'failed', reason: `write: ${err.message}` };
  }
}

/**
 * Compute the expected note path for a given report + decision date.
 * Useful for backfill scripts that want to know whether a note exists.
 */
export function notePathFor(report, decisionDate) {
  const dir = applicationsDir();
  if (!dir) return null;
  return join(dir, noteFilename(report, decisionDate));
}

export { vaultPath, applicationsDir };

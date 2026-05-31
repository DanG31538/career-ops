/**
 * lib/digest.mjs — Build the daily pipeline digest string
 *
 * Summarizes the reports posted since the last digest (state.lastDigestAt).
 * Output is a Discord-flavored markdown string ready to send to
 * #pipeline-status.
 *
 * Format:
 *   📊 Pipeline digest — YYYY-MM-DD
 *
 *   12 evaluations since last digest (3 ≥ 4.0/5)
 *
 *   **Top hits:**
 *   • {Company} — {Role} ({score}/5) → [jump]({url})
 *   • {Company} — {Role} ({score}/5) → [jump]({url})
 *   • {Company} — {Role} ({score}/5) → [jump]({url})
 *
 *   Below threshold: 9 (median 2.8)
 *
 * Empty digest (nothing posted since last) returns null — caller decides
 * whether to still post a "nothing overnight" message or stay silent.
 */

import { parseReport } from './parse-report.mjs';
import { readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPORTS_DIR = join(ROOT, 'reports');

function jumpLink(guildId, channelId, messageId) {
  if (!guildId || !channelId || !messageId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Build the digest text.
 *
 *   state:      the bot's state object (used to look up posted entries
 *               + their Discord message IDs for jump-links)
 *   threshold:  the score threshold used to decide "above" vs "below"
 *   topN:       how many top hits to include (default 3)
 *   sinceISO:   only include reports with mtime >= this (defaults to
 *               state.lastDigestAt, then falls back to "last 24h")
 *
 * Returns { text, count, aboveThreshold, considered } or null if empty.
 */
export function buildDigest({ state, threshold = 4.0, topN = 3, sinceISO = null } = {}) {
  const since = sinceISO || state?.lastDigestAt || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const sinceMs = Date.parse(since);

  // Scan reports/ for files modified since `since`.
  const considered = [];
  try {
    const files = readdirSync(REPORTS_DIR).filter(f => f.endsWith('.md'));
    for (const f of files) {
      const full = join(REPORTS_DIR, f);
      const st = statSync(full);
      if (st.mtimeMs < sinceMs) continue;
      const report = parseReport(full);
      if (!report || report.score == null) continue;
      considered.push({ file: f, full, report });
    }
  } catch {
    return null;
  }

  if (considered.length === 0) return null;

  const above = considered.filter(c => c.report.score >= threshold);
  const below = considered.filter(c => c.report.score < threshold);

  // Top hits, sorted desc by score, capped at topN
  const top = [...above]
    .sort((a, b) => b.report.score - a.report.score)
    .slice(0, topN);

  // Build lines
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`📊 **Pipeline digest — ${today}**`);
  lines.push('');
  lines.push(`${considered.length} evaluation${considered.length === 1 ? '' : 's'} since last digest (${above.length} ≥ ${threshold.toFixed(1)}/5)`);

  if (top.length > 0) {
    lines.push('');
    lines.push('**Top hits:**');
    for (const t of top) {
      const r = t.report;
      const posted = state?.posted?.[t.file];
      const jump = posted ? jumpLink(posted.guildId, posted.channelId, posted.messageId) : null;
      const tail = jump
        ? ` → [jump](${jump})`
        : (r.url ? ` → [posting](${r.url})` : '');
      const role = r.role ? ` — ${r.role}` : '';
      lines.push(`• ${r.company || 'Unknown'}${role} (${r.score.toFixed(1)}/5)${tail}`);
    }
  }

  if (below.length > 0) {
    const med = median(below.map(c => c.report.score));
    lines.push('');
    lines.push(`Below threshold: ${below.length} (median ${med != null ? med.toFixed(1) : '?'}/5)`);
  }

  return {
    text: lines.join('\n'),
    count: considered.length,
    aboveThreshold: above.length,
    considered: considered.map(c => c.file),
  };
}

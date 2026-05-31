/**
 * lib/post-eval.mjs — Post a single evaluation to #job-alerts
 *
 * Given a parsed report (from lib/parse-report.mjs):
 *   1. If score >= threshold:
 *        a. Ensure a tailored PDF exists (spawn tailor-cv.mjs if not).
 *        b. Build a Discord embed.
 *        c. Send to #job-alerts with PDF attached.
 *        d. Auto-react ✅ + ❌ so the user just taps.
 *        e. Return the sent message for state tracking.
 *   2. If score < threshold:
 *        Return null — caller still counts it in the digest.
 *
 * No state mutation here; the caller updates discord-state.json.
 *
 * Why spawn tailor-cv.mjs on-demand instead of requiring process-pipeline
 * to have run with --auto-tailor: makes the bot self-sufficient. If the
 * cron config or someone running process-pipeline manually forgot --auto-tailor,
 * the bot still posts a tailored PDF. ~30s cost per high-score report.
 */

import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));  // lib/.. → repo root
const OUTPUT_DIR = join(ROOT, 'output');
const TAILOR_SCRIPT = join(ROOT, 'tailor-cv.mjs');

// ---------------------------------------------------------------------------
// Score → embed color
// ---------------------------------------------------------------------------
function colorForScore(score) {
  if (score >= 4.5) return 0x2ecc71;  // bright green
  if (score >= 4.0) return 0xf1c40f;  // yellow
  if (score >= 3.0) return 0xe67e22;  // orange
  return 0x95a5a6;                    // gray (sub-threshold, shouldn't normally post)
}

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

// ---------------------------------------------------------------------------
// PDF resolution
// ---------------------------------------------------------------------------

/**
 * Look for an existing tailored PDF matching {company}-{date}. Returns the
 * full path or null. We accept any output/cv-{slug}-*.pdf as long as the
 * company slug matches — date may differ slightly between eval and tailor runs.
 */
function findExistingPdf(report) {
  if (!existsSync(OUTPUT_DIR)) return null;
  const slug = slugify(report.company);
  const candidates = readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith(`cv-${slug}-`) && f.endsWith('.pdf'))
    .sort()
    .reverse();  // newest first (lexical sort works for YYYY-MM-DD suffix)
  return candidates.length ? join(OUTPUT_DIR, candidates[0]) : null;
}

/**
 * Find the JD file that backs a given report. process-pipeline writes
 * jds/auto-{reportNum}-{slug}.txt and that's our best handle. If we can't
 * find one we return null and the caller skips on-demand tailoring.
 */
function findJdForReport(report) {
  if (!report.batchId) return null;
  const jdsDir = join(ROOT, 'jds');
  if (!existsSync(jdsDir)) return null;
  const prefix = `auto-${report.batchId}-`;
  const match = readdirSync(jdsDir).find(f => f.startsWith(prefix));
  return match ? join(jdsDir, match) : null;
}

function spawnTailorCv({ jdPath, company }) {
  return new Promise((resolve, reject) => {
    const args = [TAILOR_SCRIPT, '--file', jdPath];
    if (company) args.push('--company', company);

    const child = spawn('node', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`tailor-cv exited ${code}; ${stderr.trim().slice(0, 200)}`));
      const pdfMatch = stdout.match(/PDF:\s+(\S+)/);
      resolve({ pdfPath: pdfMatch ? pdfMatch[1] : null });
    });
    child.on('error', reject);
  });
}

/**
 * Ensure a PDF exists for this report. Order of preference:
 *   1. report.pdf (set by process-pipeline.mjs when --auto-tailor fired)
 *   2. An existing output/cv-{slug}-*.pdf on disk
 *   3. Spawn tailor-cv.mjs on demand against the matching JD file
 *
 * Returns the path or null if none could be produced.
 */
export async function ensurePdf(report, { onLog = () => {} } = {}) {
  if (report.pdf && existsSync(report.pdf)) return report.pdf;

  const existing = findExistingPdf(report);
  if (existing) {
    onLog(`Using existing PDF: ${basename(existing)}`);
    return existing;
  }

  const jdPath = findJdForReport(report);
  if (!jdPath) {
    onLog(`No JD file found for report ${basename(report.file || '?')} — cannot tailor`);
    return null;
  }

  onLog(`Tailoring CV against ${basename(jdPath)}...`);
  try {
    const result = await spawnTailorCv({ jdPath, company: report.company });
    if (result.pdfPath && existsSync(result.pdfPath)) {
      onLog(`Tailored PDF: ${basename(result.pdfPath)}`);
      return result.pdfPath;
    }
    onLog(`Tailor produced no usable PDF path`);
    return null;
  } catch (err) {
    onLog(`Tailor failed: ${err.message.slice(0, 200)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Embed construction
// ---------------------------------------------------------------------------
export function buildEmbed(report) {
  const scoreStr = report.score != null ? `${report.score.toFixed(1)}/5` : '?/5';
  const title = `${report.company || 'Unknown'}${report.role ? ' — ' + report.role : ''}`.slice(0, 256);

  const embed = new EmbedBuilder()
    .setColor(colorForScore(report.score ?? 0))
    .setTitle(title)
    .setURL(report.url || null)
    .addFields(
      { name: 'Score',      value: scoreStr,                     inline: true },
      { name: 'Archetype',  value: report.archetype  || 'n/a',   inline: true },
      { name: 'Legitimacy', value: report.legitimacy || 'n/a',   inline: true },
    )
    .setFooter({ text: `Report ${basename(report.file || '?')}${report.batchId ? ` · Batch ${report.batchId}` : ''}` });

  if (report.url) embed.setDescription(`[Job posting →](${report.url})`);
  return embed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Post the eval to the #job-alerts channel.
 *
 *   await postEval({ channel, report, threshold, onLog });
 *
 * Returns:
 *   - { posted: true, message, pdfPath } when score >= threshold and posted
 *   - { posted: false, reason: 'below_threshold' } when score < threshold
 *   - { posted: false, reason: 'no_score' } when score is null
 */
export async function postEval({ channel, report, threshold = 4.0, onLog = () => {} }) {
  if (report.score == null) {
    return { posted: false, reason: 'no_score' };
  }
  if (report.score < threshold) {
    return { posted: false, reason: 'below_threshold' };
  }

  // 1. Tailored PDF (best-effort — post without if tailoring fails)
  const pdfPath = await ensurePdf(report, { onLog });

  // 2. Build message payload
  const embed = buildEmbed(report);
  const files = [];
  if (pdfPath) files.push(new AttachmentBuilder(pdfPath));

  // 3. Send
  const message = await channel.send({ embeds: [embed], files });

  // 4. Auto-react
  try {
    await message.react('✅');
    await message.react('❌');
  } catch (err) {
    onLog(`Failed to add reactions: ${err.message}`);
  }

  return { posted: true, message, pdfPath };
}

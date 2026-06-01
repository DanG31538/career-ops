#!/usr/bin/env node
/**
 * backfill-obsidian.mjs — One-shot: create Obsidian notes for every
 * decided entry in discord-state.json that doesn't already have one.
 *
 * Use when:
 *   - First time setting up Phase 6 on a machine that's been running the
 *     bot without OBSIDIAN_VAULT_PATH set (decisions exist in state but no
 *     notes were ever written)
 *   - Recovery after vault dir was wiped/moved
 *   - Sanity check that the vault is in sync with state
 *
 * Idempotent: skips entries whose note file already exists. Safe to re-run.
 *
 * Usage:
 *   node backfill-obsidian.mjs                # write missing notes
 *   node backfill-obsidian.mjs --dry-run      # show what would be written
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

try { (await import('dotenv')).config(); } catch { /* dotenv optional */ }

import { parseReport } from './lib/parse-report.mjs';
import { writeNoteForDecision, notePathFor, vaultPath, applicationsDir } from './lib/obsidian-note.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const STATE_PATH  = join(ROOT, 'data', 'discord-state.json');
const REPORTS_DIR = join(ROOT, 'reports');

const dryRun = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Sanity checks
// ---------------------------------------------------------------------------
const vault = vaultPath();
if (!vault) {
  console.error('❌  OBSIDIAN_VAULT_PATH is unset in .env — nothing to write to.');
  console.error('    Set it (e.g. OBSIDIAN_VAULT_PATH=~/obsidian-vault/job-search) and re-run.');
  process.exit(1);
}
console.log(`📂  Vault: ${vault}`);
console.log(`📂  Applications dir: ${applicationsDir()}`);
console.log(dryRun ? '🧪  DRY RUN — no files will be written.\n' : '');

if (!existsSync(STATE_PATH)) {
  console.error(`❌  ${STATE_PATH} not found — bot hasn't run yet.`);
  process.exit(1);
}

const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
const entries = Object.entries(state.posted || {});
console.log(`Found ${entries.length} entries in state.`);

// ---------------------------------------------------------------------------
// Iterate
// ---------------------------------------------------------------------------
const stats = { created: 0, skipped_existing: 0, skipped_no_decision: 0, skipped_no_report: 0, failed: 0 };

for (const [reportFile, posted] of entries) {
  if (!posted.decision) { stats.skipped_no_decision++; continue; }

  const reportPath = join(REPORTS_DIR, reportFile);
  if (!existsSync(reportPath)) {
    console.log(`⚠️   ${reportFile}: report file missing on disk, skipping`);
    stats.skipped_no_report++;
    continue;
  }

  const report = parseReport(reportPath);
  if (!report) {
    console.log(`⚠️   ${reportFile}: unparseable report, skipping`);
    stats.skipped_no_report++;
    continue;
  }
  // Use the posted entry's company/role if the report parser missed them
  // (older reports with "unknown" headers but a real company in state).
  if ((!report.company || report.company === 'unknown') && posted.company) report.company = posted.company;
  if ((!report.role    || report.role    === 'unknown') && posted.role)    report.role    = posted.role;
  if (!report.url && posted.url) report.url = posted.url;

  const decisionDate = (posted.decidedAt || posted.postedAt || new Date().toISOString()).slice(0, 10);
  const expectedPath = notePathFor(report, decisionDate);

  if (expectedPath && existsSync(expectedPath)) {
    console.log(`✓ exists  ${reportFile} → ${expectedPath.split(/[\\/]/).pop()}`);
    stats.skipped_existing++;
    continue;
  }

  if (dryRun) {
    console.log(`+ would   ${reportFile} → ${expectedPath?.split(/[\\/]/).pop()}  (${posted.decision})`);
    continue;
  }

  const result = writeNoteForDecision({ report, posted, decision: posted.decision, decisionDate });
  if (result.written === 'created') {
    console.log(`+ created ${reportFile} → ${result.path.split(/[\\/]/).pop()}`);
    stats.created++;
  } else if (result.written === 'appended') {
    // Shouldn't normally hit this in backfill since we pre-check existence, but be safe.
    console.log(`~ updated ${reportFile} → ${result.path.split(/[\\/]/).pop()}`);
    stats.created++;
  } else {
    console.log(`❌ failed ${reportFile}: ${result.reason || result.written}`);
    stats.failed++;
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n' + '─'.repeat(60));
console.log(`  Backfill ${dryRun ? '(DRY RUN) ' : ''}complete`);
console.log('─'.repeat(60));
console.log(`  Created:           ${stats.created}`);
console.log(`  Already existed:   ${stats.skipped_existing}`);
console.log(`  No decision yet:   ${stats.skipped_no_decision}`);
console.log(`  Missing report:    ${stats.skipped_no_report}`);
console.log(`  Failed:            ${stats.failed}`);
console.log('─'.repeat(60));

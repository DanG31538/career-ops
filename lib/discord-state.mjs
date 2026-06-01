/**
 * lib/discord-state.mjs — Atomic JSON state for discord-bot.mjs
 *
 * Tracks:
 *   - posted:      reports we've already posted to #job-alerts
 *                  keyed by report filename (basename), value has messageId,
 *                  channelId, score, postedAt, decision (null|applied|discarded)
 *   - pendingThreads: open ✅-reaction threads awaiting --personal context
 *                  keyed by Discord thread id, value has reportFile, phase
 *   - lastDigestAt: ISO timestamp of last digest post (drives "since" window)
 *   - bootstrapped: true once the first-run watermark step has run.
 *                  When false on startup, we treat every report currently
 *                  on disk as "already seen, do not post" (see Open Q #2).
 *
 * Writes are atomic: write to tmp file, then rename. JSON is pretty-printed
 * so it's diff-friendly when debugging on the droplet.
 *
 * Single-process assumption — the bot is the only writer. No locking.
 */

import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DEFAULT_STATE = {
  bootstrapped: false,
  posted: {},
  pendingThreads: {},
  lastDigestAt: null,
};

export function loadState(path) {
  if (!existsSync(path)) {
    return structuredClone(DEFAULT_STATE);
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    // Merge with defaults so older state files pick up new fields.
    return { ...structuredClone(DEFAULT_STATE), ...parsed };
  } catch (err) {
    // Corrupt state file is fatal — better to fail loudly than overwrite it.
    throw new Error(`Failed to parse Discord state at ${path}: ${err.message}`);
  }
}

export function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  renameSync(tmp, path);
}

// ---------- Convenience mutators (caller is responsible for saveState) -------

export function markPosted(state, reportFile, info) {
  state.posted[reportFile] = {
    messageId:  info.messageId,
    channelId:  info.channelId,
    guildId:    info.guildId   || null,
    score:      info.score     ?? null,
    company:    info.company   || null,
    role:       info.role      || null,
    url:        info.url       || null,
    pdfPath:    info.pdfPath   || null,
    postedAt:   new Date().toISOString(),
    decision:   null,
  };
}

export function markDecision(state, reportFile, decision) {
  if (!state.posted[reportFile]) return false;
  state.posted[reportFile].decision = decision;
  state.posted[reportFile].decidedAt = new Date().toISOString();
  return true;
}

export function findPostedByMessageId(state, messageId) {
  for (const [file, entry] of Object.entries(state.posted)) {
    if (entry.messageId === messageId) return { file, entry };
  }
  return null;
}

/**
 * Normalize a URL for dedup comparison. Strips:
 *   - Trailing slash on the path
 *   - Query string (?utm_*, ?ref=*, anything after '?')
 *   - Fragment / anchor (#whatever)
 *   - Case on the hostname (paths stay case-sensitive — some ATS use UUIDs)
 *
 * The result is the canonical URL used as the dedup key. Same job posting
 * pasted with different tracking params or trailing slash will match.
 */
export function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let u;
  try { u = new URL(url.trim()); }
  catch { return url.trim(); }  // fall back to raw string if URL parse fails
  // Lowercase host, strip search + hash, drop trailing slash on path
  let path = u.pathname.replace(/\/+$/, '');
  if (path === '') path = '/';
  return `${u.protocol}//${u.host.toLowerCase()}${path}`;
}

/**
 * Find a previously-posted report that matches the given URL (after
 * normalization). Returns { file, entry } or null.
 *
 * Used by the bot's URL paste handler to short-circuit re-evaluation
 * of URLs that have already been processed (saves LLM tokens, gives
 * the user a "you already saw this" reply with a jump link).
 */
export function findPostedByUrl(state, url) {
  const target = normalizeUrl(url);
  if (!target) return null;
  for (const [file, entry] of Object.entries(state.posted)) {
    if (entry.url && normalizeUrl(entry.url) === target) {
      return { file, entry };
    }
  }
  return null;
}

export function registerPendingThread(state, threadId, reportFile, phase = 'awaiting_personal') {
  state.pendingThreads[threadId] = { reportFile, phase, createdAt: new Date().toISOString() };
}

/**
 * Update an existing pending thread's metadata (e.g. transition phase
 * from 'awaiting_personal' to 'awaiting_revision', or stash the last
 * draft path for revision-mode spawns). Merges into existing entry.
 */
export function updatePendingThread(state, threadId, patch) {
  if (!state.pendingThreads[threadId]) return false;
  Object.assign(state.pendingThreads[threadId], patch, { updatedAt: new Date().toISOString() });
  return true;
}

export function clearPendingThread(state, threadId) {
  delete state.pendingThreads[threadId];
}

export function isReportPosted(state, reportFile) {
  return Boolean(state.posted[reportFile]);
}

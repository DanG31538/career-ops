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

export function registerPendingThread(state, threadId, reportFile, phase = 'awaiting_personal') {
  state.pendingThreads[threadId] = { reportFile, phase, createdAt: new Date().toISOString() };
}

export function clearPendingThread(state, threadId) {
  delete state.pendingThreads[threadId];
}

export function isReportPosted(state, reportFile) {
  return Boolean(state.posted[reportFile]);
}

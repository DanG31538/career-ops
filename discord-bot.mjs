#!/usr/bin/env node
/**
 * discord-bot.mjs — Long-running Discord bot for the career-ops pipeline.
 *
 * Responsibilities (Phase 5b.2):
 *   1. On startup: watermark first run, then catch-up post any unposted
 *      report that arrived while we were offline.
 *   2. fs.watch on reports/ — when llm-eval.mjs (via process-pipeline.mjs
 *      or manually) drops a new report, post it to #job-alerts immediately
 *      (if score >= threshold). Debounced 5s to let the file finish writing.
 *   3. Daily digest to #pipeline-status at DIGEST_HOUR_ET (default 7am ET).
 *   4. Reaction handler on bot-posted #job-alerts messages:
 *        ✅ → open a thread, ask for --personal context, then run
 *             draft-application.mjs and post the result back to the thread.
 *        ❌ → mark decision: 'discarded' in state, react 👋 ack.
 *   5. Manual URL paste in #job-alerts → run lib/process-one.mjs against
 *      that URL, then post the resulting eval like any other.
 *
 * State lives in data/discord-state.json. See lib/discord-state.mjs.
 *
 * Env vars (in .env):
 *   DISCORD_BOT_TOKEN         (required)
 *   DISCORD_GUILD_ID          (required for jump-links in digest)
 *   DISCORD_ALERTS_CHANNEL_ID (required — #job-alerts)
 *   DISCORD_STATUS_CHANNEL_ID (required — #pipeline-status)
 *   DISCORD_INPUT_CHANNEL_ID  (optional — currently unused; reserved for Phase 6)
 *   DISCORD_LOGS_CHANNEL_ID   (optional — currently unused; reserved for Phase 6)
 *   DISCORD_POST_THRESHOLD    (default 4.0 — min score to post to #job-alerts)
 *   DIGEST_HOUR_ET            (default 7 — hour-of-day ET to post the digest)
 */

import { readdirSync, watch, existsSync, statSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

try { (await import('dotenv')).config(); } catch { /* dotenv optional */ }

import { Client, GatewayIntentBits, Partials, ChannelType, Events } from 'discord.js';

import { parseReport } from './lib/parse-report.mjs';
import {
  loadState, saveState,
  markPosted, markDecision, findPostedByMessageId,
  registerPendingThread, clearPendingThread,
  isReportPosted,
} from './lib/discord-state.mjs';
import { postEval } from './lib/post-eval.mjs';
import { buildDigest } from './lib/digest.mjs';
import { processOneUrl } from './lib/process-one.mjs';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ROOT = dirname(fileURLToPath(import.meta.url));
const STATE_PATH   = join(ROOT, 'data', 'discord-state.json');
const REPORTS_DIR  = join(ROOT, 'reports');
const DRAFT_SCRIPT = join(ROOT, 'draft-application.mjs');

const TOKEN              = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID           = process.env.DISCORD_GUILD_ID;
const ALERTS_CHANNEL_ID  = process.env.DISCORD_ALERTS_CHANNEL_ID;
const STATUS_CHANNEL_ID  = process.env.DISCORD_STATUS_CHANNEL_ID;
const POST_THRESHOLD     = parseFloat(process.env.DISCORD_POST_THRESHOLD || '4.0');
const DIGEST_HOUR_ET     = parseInt(process.env.DIGEST_HOUR_ET || '7', 10);

if (!TOKEN || !ALERTS_CHANNEL_ID || !STATUS_CHANNEL_ID) {
  console.error('❌  DISCORD_BOT_TOKEN, DISCORD_ALERTS_CHANNEL_ID, and DISCORD_STATUS_CHANNEL_ID are required in .env');
  process.exit(1);
}

const URL_REGEX = /https?:\/\/\S+/i;

// ---------------------------------------------------------------------------
// Logging — single timestamped logger; everything else uses console.error
// (which Docker captures in `docker compose logs`).
// ---------------------------------------------------------------------------
function log(level, msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}`);
}
const logInfo  = (m) => log('info',  m);
const logWarn  = (m) => log('warn',  m);
const logError = (m) => log('error', m);

// ---------------------------------------------------------------------------
// State (loaded once at startup, persisted on every mutation)
// ---------------------------------------------------------------------------
let state = loadState(STATE_PATH);
function persist() {
  try { saveState(STATE_PATH, state); }
  catch (err) { logError(`Failed to persist state: ${err.message}`); }
}

// ---------------------------------------------------------------------------
// Discord client
// ---------------------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  // Partials so we get reaction events on messages the bot didn't cache
  // (e.g. older messages after a restart).
  partials: [Partials.Message, Partials.Reaction, Partials.Channel],
});

// ---------------------------------------------------------------------------
// Channel lookup helpers
// ---------------------------------------------------------------------------
async function getAlertsChannel() {
  const ch = await client.channels.fetch(ALERTS_CHANNEL_ID);
  if (!ch || !ch.isTextBased()) throw new Error(`#job-alerts channel ${ALERTS_CHANNEL_ID} is not a text channel`);
  return ch;
}
async function getStatusChannel() {
  const ch = await client.channels.fetch(STATUS_CHANNEL_ID);
  if (!ch || !ch.isTextBased()) throw new Error(`#pipeline-status channel ${STATUS_CHANNEL_ID} is not a text channel`);
  return ch;
}

// ---------------------------------------------------------------------------
// Posting + state
//
// In-flight set guards against a race where the same report gets posted twice:
// when a URL is pasted, handlePastedUrl runs process-one (which writes the
// report file ~30s in, triggering fs.watch's debounced timer ~5s later), and
// THEN handlePastedUrl calls postReportFile itself. Without this lock, both
// the watcher and the paste handler can pass the isReportPosted check before
// either calls markPosted, and both will post. In-memory Set is enough — the
// bot is single-process; no need to persist this.
// ---------------------------------------------------------------------------
const inFlightPosts = new Set();

async function postReportFile(reportFile) {
  if (isReportPosted(state, reportFile)) {
    logInfo(`Already posted: ${reportFile}`);
    return null;
  }
  if (inFlightPosts.has(reportFile)) {
    logInfo(`Already posting (in-flight): ${reportFile}`);
    return null;
  }
  inFlightPosts.add(reportFile);
  try {
    return await postReportFileInner(reportFile);
  } finally {
    inFlightPosts.delete(reportFile);
  }
}

async function postReportFileInner(reportFile) {
  const fullPath = join(REPORTS_DIR, reportFile);
  const report = parseReport(fullPath);
  if (!report || report.score == null) {
    logWarn(`Skipping unparseable report: ${reportFile}`);
    return null;
  }

  if (report.score < POST_THRESHOLD) {
    logInfo(`Sub-threshold (${report.score.toFixed(1)} < ${POST_THRESHOLD}): ${reportFile} — digest only`);
    // Still mark as "seen" so digest can compute counts but we don't re-look at it.
    // We store with no messageId so postEval can detect if it was previously sub-threshold.
    markPosted(state, reportFile, {
      messageId: null, channelId: null, guildId: GUILD_ID,
      score: report.score, company: report.company, role: report.role, url: report.url,
    });
    persist();
    return null;
  }

  const channel = await getAlertsChannel();
  logInfo(`Posting ${reportFile} (score ${report.score.toFixed(1)})...`);
  const result = await postEval({
    channel, report, threshold: POST_THRESHOLD,
    onLog: (m) => logInfo(`  [post-eval] ${m}`),
  });

  if (!result.posted) {
    logInfo(`postEval declined to post ${reportFile}: ${result.reason}`);
    return null;
  }

  markPosted(state, reportFile, {
    messageId: result.message.id,
    channelId: result.message.channelId,
    guildId:   result.message.guildId || GUILD_ID,
    score:     report.score,
    company:   report.company,
    role:      report.role,
    url:       report.url,
    pdfPath:   result.pdfPath,
  });
  persist();
  logInfo(`Posted ${reportFile} → message ${result.message.id}`);
  return result.message;
}

// ---------------------------------------------------------------------------
// Bootstrap: first-run watermark
// ---------------------------------------------------------------------------
function bootstrapWatermarkIfNeeded() {
  if (state.bootstrapped) return;
  logInfo('First run detected — watermarking existing reports as "already seen"');
  if (existsSync(REPORTS_DIR)) {
    for (const f of readdirSync(REPORTS_DIR).filter(x => x.endsWith('.md'))) {
      const report = parseReport(join(REPORTS_DIR, f));
      if (!report) continue;
      markPosted(state, f, {
        messageId: null, channelId: null, guildId: GUILD_ID,
        score: report.score, company: report.company, role: report.role, url: report.url,
      });
    }
  }
  state.bootstrapped = true;
  state.lastDigestAt = new Date().toISOString();
  persist();
  logInfo(`Watermarked ${Object.keys(state.posted).length} existing report(s).`);
}

// ---------------------------------------------------------------------------
// Catch-up scan: post anything that arrived while we were offline.
// ---------------------------------------------------------------------------
async function catchUpScan() {
  if (!existsSync(REPORTS_DIR)) return;
  const files = readdirSync(REPORTS_DIR).filter(f => f.endsWith('.md')).sort();
  const unposted = files.filter(f => !isReportPosted(state, f));
  if (unposted.length === 0) {
    logInfo('Catch-up scan: nothing new.');
    return;
  }
  logInfo(`Catch-up scan: ${unposted.length} unposted report(s) to process.`);
  for (const f of unposted) {
    try { await postReportFile(f); }
    catch (err) { logError(`Catch-up failed for ${f}: ${err.message}`); }
  }
}

// ---------------------------------------------------------------------------
// fs.watch on reports/ — debounced per file
// ---------------------------------------------------------------------------
const watchDebounce = new Map();  // filename → timeout handle
function setupReportWatcher() {
  if (!existsSync(REPORTS_DIR)) {
    logWarn(`reports/ does not exist — watcher disabled. Will be created when llm-eval first runs.`);
    return;
  }
  watch(REPORTS_DIR, (event, filename) => {
    if (!filename || !filename.endsWith('.md')) return;
    if (isReportPosted(state, filename)) return;

    const existing = watchDebounce.get(filename);
    if (existing) clearTimeout(existing);
    watchDebounce.set(filename, setTimeout(async () => {
      watchDebounce.delete(filename);
      const full = join(REPORTS_DIR, filename);
      if (!existsSync(full)) return;
      // Double-check size > 0 so we don't read a half-written file.
      try {
        const st = statSync(full);
        if (st.size === 0) return;
      } catch { return; }

      try {
        logInfo(`Watcher: new report ${filename}`);
        await postReportFile(filename);
      } catch (err) {
        logError(`Watcher failed for ${filename}: ${err.message}`);
      }
    }, 5000));
  });
  logInfo(`Watching ${REPORTS_DIR} for new reports (5s debounce).`);
}

// ---------------------------------------------------------------------------
// Daily digest — check every minute, post if it's the configured hour
// (in America/New_York) and we haven't posted today.
// ---------------------------------------------------------------------------
function nowInET() {
  // Intl gives us the local hour without a TZ-aware Date math dance.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t)?.value;
  return {
    hour: parseInt(get('hour'), 10),
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

function digestAlreadyPostedToday() {
  if (!state.lastDigestAt) return false;
  const lastYmd = new Date(state.lastDigestAt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const { ymd } = nowInET();
  return lastYmd === ymd;
}

async function maybePostDigest() {
  const { hour } = nowInET();
  if (hour !== DIGEST_HOUR_ET) return;
  if (digestAlreadyPostedToday()) return;

  logInfo(`Building digest (hour=${hour}ET)...`);
  const digest = buildDigest({ state, threshold: POST_THRESHOLD });
  if (!digest) {
    logInfo('No new reports since last digest — skipping post.');
    // Still bump lastDigestAt so we don't recheck every minute today.
    state.lastDigestAt = new Date().toISOString();
    persist();
    return;
  }
  try {
    const channel = await getStatusChannel();
    await channel.send({ content: digest.text });
    state.lastDigestAt = new Date().toISOString();
    persist();
    logInfo(`Posted digest (${digest.count} reports, ${digest.aboveThreshold} above threshold).`);
  } catch (err) {
    logError(`Failed to post digest: ${err.message}`);
  }
}

function setupDigestTimer() {
  // Check every 60s. Cheap and tolerant of small drift.
  setInterval(() => { maybePostDigest().catch(err => logError(`digest check: ${err.message}`)); }, 60_000);
  logInfo(`Digest timer armed: ${DIGEST_HOUR_ET}:00 America/New_York`);
}

// ---------------------------------------------------------------------------
// Reaction handler (✅ → draft thread; ❌ → mark discarded)
// ---------------------------------------------------------------------------
async function handleReactionAdd(reaction, user) {
  if (user.bot) return;

  // Partial reaction → fetch full
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  if (reaction.message.partial) {
    try { await reaction.message.fetch(); } catch { return; }
  }

  if (reaction.message.channelId !== ALERTS_CHANNEL_ID) return;

  const tracked = findPostedByMessageId(state, reaction.message.id);
  if (!tracked) return;  // not a bot-posted eval

  const emoji = reaction.emoji.name;
  if (emoji === '✅') {
    await handleApproveReaction({ message: reaction.message, reportFile: tracked.file });
  } else if (emoji === '❌') {
    await handleRejectReaction({ message: reaction.message, reportFile: tracked.file });
  }
}

async function handleApproveReaction({ message, reportFile }) {
  // Idempotent: if a thread is already open for this report, do nothing.
  const alreadyOpen = Object.values(state.pendingThreads).some(p => p.reportFile === reportFile);
  if (alreadyOpen) {
    logInfo(`✅ on ${reportFile}: thread already open, ignoring.`);
    return;
  }

  logInfo(`✅ on ${reportFile}: opening thread for --personal context.`);
  let thread;
  try {
    thread = await message.startThread({
      name: `Draft — ${(state.posted[reportFile]?.company || 'application').slice(0, 80)}`,
      autoArchiveDuration: 1440,  // 24h
    });
  } catch (err) {
    logError(`Failed to start thread for ${reportFile}: ${err.message}`);
    return;
  }

  registerPendingThread(state, thread.id, reportFile, 'awaiting_personal');
  persist();

  await thread.send({
    content:
      `Reply in this thread with **1–2 sentences of your genuine connection to ${state.posted[reportFile]?.company || 'this company'}** ` +
      `(used as the foundation of the cover letter), or reply **\`skip\`** to draft without personal context.`,
  });
}

async function handleRejectReaction({ message, reportFile }) {
  if (state.posted[reportFile]?.decision === 'discarded') return;
  markDecision(state, reportFile, 'discarded');
  persist();
  logInfo(`❌ on ${reportFile}: marked discarded.`);
  try { await message.react('👋'); }
  catch (err) { logWarn(`Failed to ack ❌ reaction: ${err.message}`); }
}

// ---------------------------------------------------------------------------
// Message handler: thread replies (for --personal context) + URL pastes
// ---------------------------------------------------------------------------
async function handleMessageCreate(msg) {
  if (msg.author.bot) return;

  // (A) Reply in a pending thread → drive draft-application.mjs
  if (msg.channel.type === ChannelType.PublicThread || msg.channel.type === ChannelType.PrivateThread) {
    const pending = state.pendingThreads[msg.channel.id];
    if (pending && pending.phase === 'awaiting_personal') {
      await handleThreadPersonalReply(msg, pending);
      return;
    }
  }

  // (B) URL pasted in #job-alerts → process it like a normal eval
  if (msg.channel.id === ALERTS_CHANNEL_ID) {
    const m = msg.content.match(URL_REGEX);
    if (m) {
      await handlePastedUrl(msg, m[0]);
      return;
    }
  }
}

async function handleThreadPersonalReply(msg, pending) {
  const personal = msg.content.trim();
  const skip = personal.toLowerCase() === 'skip';

  // Mark thread as no longer awaiting (prevent double-handling on rapid replies)
  clearPendingThread(state, msg.channel.id);
  persist();

  const posted = state.posted[pending.reportFile];
  if (!posted) {
    await msg.channel.send(`⚠️  Internal: I lost track of the report for this thread. Aborting draft.`);
    return;
  }
  // Mark applied decision now — user explicitly approved.
  markDecision(state, pending.reportFile, 'applied');
  persist();

  await msg.channel.send(skip
    ? `Drafting without personal context — this will take ~30s.`
    : `Drafting with your context — this will take ~30s.`);

  // Find the JD file (same logic as post-eval.findJdForReport — keep this
  // inline so bot doesn't depend on a private helper).
  const jdPath = findJdForBatchId(posted, pending.reportFile);
  if (!jdPath) {
    await msg.channel.send(`⚠️  I can't find the JD file for this report (need \`jds/auto-{batchId}-*.txt\`). Aborting draft.`);
    return;
  }

  try {
    const draftPath = await spawnDraftApplication({
      jdPath,
      company: posted.company,
      personal: skip ? null : personal,
    });
    await postDraftToThread(msg.channel, draftPath);
  } catch (err) {
    await msg.channel.send(`❌  Draft failed: \`${err.message.slice(0, 300)}\``);
  }
}

async function handlePastedUrl(msg, url) {
  logInfo(`Pasted URL in #job-alerts: ${url}`);
  await msg.react('⏳');
  try {
    const result = await processOneUrl(url, {
      autoTailorThreshold: POST_THRESHOLD,
      onLog: (m) => logInfo(`  [process-one] ${m}`),
    });
    if (result.status !== 'completed') {
      await msg.reply(`Could not process: ${result.reason || result.status}`);
      return;
    }

    // Post the resulting report through the same path as the watcher would.
    // postReportFile returns null in two non-failure cases:
    //   - sub-threshold (most common): score < POST_THRESHOLD → no embed posted
    //   - in-flight race: another path is already posting this report
    // Without explicit feedback, the user sees only ⏳→✅ on their own message
    // and has no idea WHY no embed appeared. Reply inline with the outcome.
    const message = result.reportFile ? await postReportFile(result.reportFile) : null;
    if (!message) {
      // Re-parse the report to get score + company for a useful reply.
      const report = result.report || (result.reportFile ? parseReport(join(REPORTS_DIR, result.reportFile)) : null);
      if (report && report.score != null && report.score < POST_THRESHOLD) {
        await msg.reply(
          `📊 Evaluated **${report.company || 'unknown'} — ${report.role || 'unknown'}**: ` +
          `**${report.score.toFixed(1)}/5** (below your ${POST_THRESHOLD}/5 threshold, not posted to #job-alerts). ` +
          `Full report: \`reports/${result.reportFile}\``
        );
      } else if (report && report.score == null) {
        await msg.reply(`⚠️  Evaluated but couldn't parse a score. Check \`reports/${result.reportFile}\` for the raw output.`);
      }
      // If no report at all or in-flight race, skip the reply — neither case is informative to the user.
    }
    await msg.react('✅');
  } catch (err) {
    logError(`Pasted URL failed: ${err.message}`);
    await msg.reply(`❌  Failed to process: \`${err.message.slice(0, 300)}\``);
  } finally {
    try { await msg.reactions.cache.get('⏳')?.users.remove(client.user.id); }
    catch { /* best effort */ }
  }
}

// ---------------------------------------------------------------------------
// JD + draft helpers
// ---------------------------------------------------------------------------
function findJdForBatchId(_posted, reportFile) {
  // The batchId is the numeric prefix of the report filename — same as the JD's
  // auto-{batchId}- prefix.
  const m = reportFile.match(/^(\d{3})-/);
  if (!m) return null;
  const batchId = m[1];
  const jdsDir = join(ROOT, 'jds');
  if (!existsSync(jdsDir)) return null;
  const prefix = `auto-${batchId}-`;
  const match = readdirSync(jdsDir).find(f => f.startsWith(prefix));
  return match ? join(jdsDir, match) : null;
}

function spawnDraftApplication({ jdPath, company, personal }) {
  return new Promise((resolve, reject) => {
    const args = [DRAFT_SCRIPT, '--file', jdPath];
    if (company)  args.push('--company', company);
    if (personal) args.push('--personal', personal);

    const child = spawn('node', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`draft-application exited ${code}; ${stderr.trim().slice(0, 200)}`));
      // draft-application.mjs prints "Markdown: <path>" or similar at the end.
      const m = stdout.match(/(?:Markdown|Output|Written|Saved):\s+(\S+\.md)/i)
             || stdout.match(/(output\/application-\S+\.md)/);
      if (!m) return reject(new Error(`draft-application produced no recognizable output path. stdout tail: ${stdout.trim().slice(-200)}`));
      resolve(m[1]);
    });
    child.on('error', reject);
  });
}

async function postDraftToThread(thread, draftPath) {
  const { readFileSync } = await import('fs');
  let text;
  try { text = readFileSync(draftPath, 'utf-8'); }
  catch (err) {
    await thread.send(`⚠️  Draft completed but I can't read \`${draftPath}\`: ${err.message}`);
    return;
  }
  // Always attach the file
  const { AttachmentBuilder } = await import('discord.js');
  await thread.send({
    content: `📝 Draft generated (\`${basename(draftPath)}\`):`,
    files: [new AttachmentBuilder(draftPath)],
  });
  // Also post inline content, chunked to Discord's 2000-char limit
  const CHUNK = 1900;
  for (let i = 0; i < text.length; i += CHUNK) {
    const chunk = text.slice(i, i + CHUNK);
    await thread.send({ content: `\`\`\`md\n${chunk}\n\`\`\`` });
  }
}

// ---------------------------------------------------------------------------
// Wire up + start
// ---------------------------------------------------------------------------
client.once(Events.ClientReady, async () => {
  logInfo(`Logged in as ${client.user.tag}`);
  logInfo(`Threshold: ${POST_THRESHOLD} · Digest hour ET: ${DIGEST_HOUR_ET}`);
  try {
    bootstrapWatermarkIfNeeded();
    await catchUpScan();
    setupReportWatcher();
    setupDigestTimer();
    logInfo('Bot ready.');
  } catch (err) {
    logError(`Startup error: ${err.message}`);
  }
});

client.on(Events.MessageReactionAdd, (reaction, user) => {
  handleReactionAdd(reaction, user).catch(err => logError(`reaction handler: ${err.message}`));
});
client.on(Events.MessageCreate, (msg) => {
  handleMessageCreate(msg).catch(err => logError(`message handler: ${err.message}`));
});

client.on(Events.Error,      (err) => logError(`client error: ${err.message}`));
client.on(Events.ShardError, (err) => logError(`shard error: ${err.message}`));
process.on('uncaughtException', (err) => logError(`uncaught: ${err.stack || err.message}`));
process.on('unhandledRejection', (err) => logError(`unhandled rejection: ${err?.stack || err}`));

await client.login(TOKEN);

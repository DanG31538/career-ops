// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Ashby provider — hits the public posting-api endpoint.
// Auto-detects from careers_url pattern `https://jobs.ashbyhq.com/<slug>`.

import { stripHtml } from '../lib/strip-html.mjs';

function resolveApiUrl(entry) {
  const url = entry.careers_url || '';
  const match = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (!match) return null;
  return `https://api.ashbyhq.com/posting-api/job-board/${match[1]}?includeCompensation=true`;
}

/** @type {Provider} */
export default {
  id: 'ashby',

  detect(entry) {
    const apiUrl = resolveApiUrl(entry);
    return apiUrl ? { url: apiUrl } : null;
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`ashby: cannot derive API URL for ${entry.name}`);
    const json = await ctx.fetchJson(apiUrl);
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    return jobs.map(j => ({
      title: j.title || '',
      url: j.jobUrl || '',
      company: entry.name,
      location: j.location || '',
    }));
  },

  /**
   * Fetch a single job's full content from an Ashby job URL.
   * URL shape: https://jobs.ashbyhq.com/{company}/{job_id_or_slug}
   *
   * Ashby's posting-api doesn't have a per-job endpoint — it returns the full
   * list with descriptions included. We fetch the company's full list and find
   * the matching job by URL or ID. Slightly wasteful per call, but the list
   * endpoint is fast and the response is cacheable in practice.
   */
  async fetchJobDetail(url, ctx) {
    const m = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([^/?#]+)/);
    if (!m) throw new Error(`ashby: cannot parse job URL: ${url}`);
    const [, company, jobId] = m;
    const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${company}?includeCompensation=true`;
    const json = await ctx.fetchJson(apiUrl);
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    // Try exact match by ID first, then by URL substring (Ashby URLs sometimes
    // have suffix slugs)
    let job = jobs.find(j => j.id === jobId);
    if (!job) job = jobs.find(j => (j.jobUrl || '').includes(jobId));
    if (!job) throw new Error(`ashby: job not found for id "${jobId}" in board "${company}"`);
    const text = (job.descriptionHtml ? stripHtml(job.descriptionHtml) : '') ||
                 (job.descriptionPlain || '');
    return {
      title: job.title || '',
      location: job.location || '',
      text,
      url: job.jobUrl || url,
    };
  },
};

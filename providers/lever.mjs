// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Lever provider — hits the public postings endpoint.
// Auto-detects from careers_url pattern `https://jobs.lever.co/<slug>`.

import { stripHtml } from '../lib/strip-html.mjs';

function resolveApiUrl(entry) {
  const url = entry.careers_url || '';
  const match = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (!match) return null;
  return `https://api.lever.co/v0/postings/${match[1]}`;
}

/** @type {Provider} */
export default {
  id: 'lever',

  detect(entry) {
    const apiUrl = resolveApiUrl(entry);
    return apiUrl ? { url: apiUrl } : null;
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`lever: cannot derive API URL for ${entry.name}`);
    const json = await ctx.fetchJson(apiUrl);
    if (!Array.isArray(json)) return [];
    return json.map(j => ({
      title: j.text || '',
      url: j.hostedUrl || '',
      company: entry.name,
      location: j.categories?.location || '',
    }));
  },

  /**
   * Fetch a single job's full content from a Lever job URL.
   * URL shape: https://jobs.lever.co/{company}/{job_id}
   * API:       https://api.lever.co/v0/postings/{company}/{job_id}?mode=json
   *
   * Lever returns descriptionPlain (already plain text), description (HTML),
   * and lists[] (responsibilities/qualifications/benefits with HTML content).
   * We assemble the full JD from description + each list block.
   */
  async fetchJobDetail(url, ctx) {
    const m = url.match(/jobs\.lever\.co\/([^/?#]+)\/([^/?#]+)/);
    if (!m) throw new Error(`lever: cannot parse job URL: ${url}`);
    const [, company, jobId] = m;
    const apiUrl = `https://api.lever.co/v0/postings/${company}/${jobId}?mode=json`;
    const json = await ctx.fetchJson(apiUrl);
    let text = json.descriptionPlain || stripHtml(json.description || '');
    if (Array.isArray(json.lists)) {
      for (const list of json.lists) {
        if (list.text) text += `\n\n## ${list.text}\n`;
        if (list.content) text += stripHtml(list.content);
      }
    }
    return {
      title: json.text || '',
      location: json.categories?.location || '',
      text: text.trim(),
      url: json.hostedUrl || url,
    };
  },
};

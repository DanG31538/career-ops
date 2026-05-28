// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Greenhouse provider — hits the public boards-api JSON endpoint.
// Handles both explicit `api:` URLs and auto-detection from `careers_url`.

import { stripHtml } from '../lib/strip-html.mjs';

const ALLOWED_GREENHOUSE_HOSTS = new Set([
  'boards-api.greenhouse.io',
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'job-boards.eu.greenhouse.io',
]);

function assertGreenhouseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`greenhouse: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`greenhouse: URL must use HTTPS: ${url}`);
  if (!ALLOWED_GREENHOUSE_HOSTS.has(parsed.hostname))
    throw new Error(`greenhouse: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_GREENHOUSE_HOSTS].join(', ')}`);
  return url;
}

function resolveApiUrl(entry) {
  if (entry.api) {
    assertGreenhouseUrl(entry.api);
    return entry.api;
  }
  const url = entry.careers_url || '';
  const match = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (match) return `https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs`;
  return null;
}

/** @type {Provider} */
export default {
  id: 'greenhouse',

  detect(entry) {
    const apiUrl = resolveApiUrl(entry);
    return apiUrl ? { url: apiUrl } : null;
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`greenhouse: cannot derive API URL for ${entry.name}`);
    assertGreenhouseUrl(apiUrl);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertGreenhouseUrl above it guarantees the final hostname stays in the allowlist.
    const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    return jobs.filter(j => j.absolute_url).map(j => ({
      title: j.title || '',
      url: j.absolute_url,
      company: entry.name,
      location: j.location?.name || '',
    }));
  },

  /**
   * Fetch a single job's full content from a Greenhouse job URL.
   * URL shape: https://job-boards.greenhouse.io/{company}/jobs/{job_id}
   * (or boards.greenhouse.io / job-boards.eu.greenhouse.io)
   * API:       https://boards-api.greenhouse.io/v1/boards/{company}/jobs/{job_id}?content=true
   *
   * Returns { title, location, text, url } where text is plain text (HTML stripped).
   * Throws on 404 (job no longer exists), other HTTP errors, or unparseable URL.
   */
  async fetchJobDetail(url, ctx) {
    const m = url.match(/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
    if (!m) throw new Error(`greenhouse: cannot parse job URL: ${url}`);
    const [, company, jobId] = m;
    const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${company}/jobs/${jobId}?content=true`;
    assertGreenhouseUrl(apiUrl);
    const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
    return {
      title: json.title || '',
      location: json.location?.name || '',
      text: stripHtml(json.content || ''),
      url: json.absolute_url || url,
    };
  },
};

/**
 * lib/parse-cv.mjs — Deterministic parser for cv.md
 *
 * Shared by tailor-cv.mjs and draft-application.mjs (and eventually
 * discord-bot.mjs). Lives here so changes to cv.md format propagate
 * to every consumer in one place.
 *
 * Parses standard cv.md structure into a structured object with stable
 * IDs on every job, bullet, education entry, and skill category.
 *
 * Expected markdown shape:
 *   # Name
 *   <contact line — any plain text>
 *
 *   ## Summary
 *   <prose paragraph(s)>
 *
 *   ## Experience
 *   ### Role — Company
 *   *Period · Location*
 *   - bullet
 *   - bullet
 *
 *   ## Service
 *   ### Role — Org
 *   *Period · Location*
 *   <prose paragraph OR bullets>
 *
 *   ## Education
 *   ### Degree — Institution
 *   *Period*
 *
 *   ## Skills
 *   **Category:** items, items, items
 *
 * Stable IDs assigned at parse time:
 *   exp-N, srv-N, edu-N, skill-N
 *   b-{parent-id}-N for each bullet under a parent
 */

export function parseCv(markdown) {
  const cv = {
    name: '',
    summary: '',
    experience: [],   // [{ id, role, company, period, location, bullets: [{id, text}], description }]
    service: [],      // same shape; may have `description` instead of bullets
    education: [],    // [{ id, degree, institution, period, description }]
    skills: [],       // [{ id, category, items }]
  };

  let expCounter = 0, srvCounter = 0, eduCounter = 0, skillCounter = 0;

  const lines = markdown.split('\n');
  let section = null;
  let currentEntry = null;
  let summaryBuffer = [];
  let serviceDescBuffer = [];

  function flushSummary() {
    if (summaryBuffer.length) {
      cv.summary = summaryBuffer.join(' ').replace(/\s+/g, ' ').trim();
      summaryBuffer = [];
    }
  }
  function flushServiceDesc() {
    if (currentEntry && section === 'service' && serviceDescBuffer.length) {
      currentEntry.description = serviceDescBuffer.join(' ').replace(/\s+/g, ' ').trim();
      serviceDescBuffer = [];
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();

    if (line.startsWith('# ') && !cv.name) {
      cv.name = line.slice(2).trim();
      continue;
    }

    if (line.startsWith('## ')) {
      flushSummary();
      flushServiceDesc();
      section = line.slice(3).trim().toLowerCase();
      currentEntry = null;
      continue;
    }

    if (line.startsWith('### ')) {
      flushServiceDesc();
      const heading = line.slice(4).trim();
      const parts = heading.split(/\s+[—–-]\s+/);
      const left = (parts[0] || '').trim();
      const right = parts.slice(1).join(' — ').trim();

      if (section === 'experience') {
        currentEntry = {
          id: `exp-${++expCounter}`,
          role: left, company: right,
          period: '', location: '',
          bullets: [], description: '',
        };
        cv.experience.push(currentEntry);
      } else if (section === 'service') {
        currentEntry = {
          id: `srv-${++srvCounter}`,
          role: left, company: right,
          period: '', location: '',
          bullets: [], description: '',
        };
        cv.service.push(currentEntry);
      } else if (section === 'education') {
        currentEntry = {
          id: `edu-${++eduCounter}`,
          degree: left, institution: right,
          period: '', description: '',
        };
        cv.education.push(currentEntry);
      } else {
        currentEntry = null;
      }
      continue;
    }

    const italicMatch = trimmed.match(/^\*([^*]+)\*$/);
    if (italicMatch && currentEntry) {
      const content = italicMatch[1];
      const parts = content.split('·').map(s => s.trim());
      currentEntry.period = parts[0] || '';
      currentEntry.location = parts.slice(1).join(' · ') || '';
      continue;
    }

    if ((line.startsWith('- ') || line.startsWith('* ')) && currentEntry) {
      const bulletText = line.slice(2).trim();
      const bulletId = `b-${currentEntry.id}-${currentEntry.bullets.length + 1}`;
      currentEntry.bullets.push({ id: bulletId, text: bulletText });
      continue;
    }

    if (section === 'skills') {
      const skillMatch = trimmed.match(/^\*\*([^*]+):\*\*\s*(.+)$/);
      if (skillMatch) {
        cv.skills.push({
          id: `skill-${++skillCounter}`,
          category: skillMatch[1].trim(),
          items: skillMatch[2].trim(),
        });
      }
      continue;
    }

    if (section === 'summary' && trimmed) {
      summaryBuffer.push(trimmed);
    } else if (section === 'service' && currentEntry && trimmed && !trimmed.startsWith('#')) {
      serviceDescBuffer.push(trimmed);
    }
  }

  flushSummary();
  flushServiceDesc();
  return cv;
}

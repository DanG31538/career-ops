# User Profile Context — Daniel Garcia

<!-- ============================================================
     THIS FILE IS YOURS. It will NEVER be auto-updated.

     Customizations here ALWAYS win over modes/_shared.md defaults.

     The system reads _shared.md first (6 AI/GenAI archetypes),
     then this file (8 ML archetypes + Dan's framing + overrides).
     Both archetype lists are available to the LLM at evaluation
     time — it picks whichever archetype best fits the JD.
     ============================================================ -->

## ⚠️ MANDATORY OVERRIDES — APPLY BEFORE OTHER EVALUATION STEPS

These rules override anything in `modes/_shared.md` and `modes/oferta.md`.
They are non-negotiable and must be applied **before** scoring any block.

### Override 1: Title-Based Role-Shape Caps

Dan is an **applied / production ML engineer**, NOT a research scientist.
He ships systems; he does not invent novel ML methods or publish papers.

**Step 1 — Parse the title.** Identify:
- A **seniority word**: `Senior`, `Staff`, `Principal`, `Lead`, `Distinguished`, `II`, `III`, `IV`
- A **scientist word**: `Scientist`, `Researcher`, `Research Scientist`, `Applied Scientist`

**Step 2 — Apply cap.** If the title contains **both** a seniority word **AND**
a scientist word, **cap overall score at 3.0/5**. This applies regardless of
which archetype is detected — title-based caps trump archetype-based scoring.

**Examples that MUST be capped at 3.0:**

| Title | Cap? | Reason |
|---|---|---|
| Principal Applied Scientist | **CAPPED at 3.0** | "Principal" + "Scientist" |
| Senior Research Scientist | **CAPPED at 3.0** | "Senior" + "Scientist" |
| Staff Scientist | **CAPPED at 3.0** | "Staff" + "Scientist" |
| Applied Scientist II | **CAPPED at 3.0** | "II" + "Scientist" |
| Lead Researcher | **CAPPED at 3.0** | "Lead" + "Researcher" |
| Distinguished AI Researcher | **CAPPED at 3.0** | "Distinguished" + "Researcher" |
| Senior ML Engineer | NOT capped | No scientist word |
| Staff Math Libraries Engineer | NOT capped | No scientist word |
| Senior Software Engineer (AI/ML) | NOT capped | No scientist word |

**Step 3 — "Applied" in the title does NOT lift the cap.** Despite the word,
"Applied Scientist" at Amazon, "Applied AI Researcher" at Microsoft, and
similar roles are all research-tier positions that expect novel methods and
publication-quality output. The word "Applied" means "applied to a domain";
it does NOT mean "no research required". **Cap these at 3.0.**

**Step 4 — Cap can only be lifted by EXPLICIT JD body text.** A cap MAY be
lifted to a maximum of 4.0 if the JD body (not the title) explicitly contains
text like:
- "No publication requirement"
- "Production-focused — we do not expect papers"
- "Industry research lab focused on shipping, not publishing"
- "Deploys models to production rather than writing papers"

The TITLE alone NEVER lifts the cap. Only explicit body text does.

**Step 5 — Full lift via domain match (rare).** The cap is fully lifted only
if Dan's prior research at LLNL (neural-interface, microelectronics) or CMU
CNBC (synaptic transmission, Inception-ResNet for neuroscience) **directly**
matches the JD's research domain — e.g., BCI startups, neurotech, neuro-
adjacent biotech, medical imaging. Cite the specific overlap in Block C.

**MANDATORY: Block C must explicitly document the cap decision** with one of:
- "**Title Cap Analysis:** CAPPED at 3.0 — title contains [seniority] + [scientist word]."
- "**Title Cap Analysis:** NOT capped — title contains no scientist word."
- "**Title Cap Analysis:** Cap lifted to 4.0 — JD body says '[exact text]'."
- "**Title Cap Analysis:** Cap fully lifted — Dan's [LLNL / CMU] work directly matches research domain [X]."

Skipping the Title Cap Analysis line in Block C is a calibration failure.

### Override 2: Other Tier Caps

Apply if Override 1 didn't fire, in addition to Override 1 if both apply.

- **Cap 3.5/5** if PhD is a HARD requirement (text says "PhD required", not "PhD preferred")
- **Cap 3.5/5** if publication record / first-author papers required
- **Cap 3.5/5** if novel theoretical contributions or new algorithm invention required
- **Cap 3.5/5** if graduate-level theoretical math required (measure theory, advanced optimization theory, causal inference at PhD depth, Bayesian deep learning theory)
- **Cap 3.5/5** if title contains `Staff`, `Principal`, or `Distinguished` (Engineer-suffixed; Scientist-suffixed is already capped at 3.0 by Override 1). These titles are above the current target ceiling of Senior IC. Cap may be lifted to 4.0 only if the JD body explicitly says Staff is used loosely (e.g. "we use Staff to mean 5-7yr+ ICs", "Staff here is what most companies call Senior", "no requirement for prior Staff-level scope or formal Staff-Engineer experience"). Cite the exact body text in Block C.
- **Cap 2.5/5** if academic / faculty / postdoc / teaching-heavy / tenure-track

### Override 3: Org-Leadership Title Cap

Dan has **coordinated** large cross-functional teams (60-person team at PNC)
but has **never held a Manager / Director / VP / Head title** and does not
have direct-report management experience. Roles whose titles signal org-level
leadership (managing managers, owning P&L, hiring/firing authority) are
mismatched regardless of the technical-skill overlap.

**Step 1 — Parse the title for org-leadership signals.** Org-leadership words:
`Head`, `Vice President`, `VP`, `Director`, `Chief`, `CTO`, `CIO`, `CDO`,
`Chief [X] Officer`, `Manager`, `Engineering Manager`, `EM`.

**Step 2 — Apply cap.** If the title contains any org-leadership word
indicating people management or org-level scope, **cap overall score at 3.0/5**.
This applies regardless of how well skills/domain match — title-based caps
trump archetype-based scoring.

**Examples that MUST be capped at 3.0:**

| Title | Cap? | Reason |
|---|---|---|
| Head of Machine Learning | **CAPPED at 3.0** | "Head of" = org leader |
| VP of Engineering | **CAPPED at 3.0** | "VP" = exec |
| Director of Data Science | **CAPPED at 3.0** | "Director of" = org leader |
| Chief AI Officer | **CAPPED at 3.0** | "Chief X Officer" = exec |
| Engineering Manager | **CAPPED at 3.0** | "Manager" = people mgmt |
| Senior ML Engineer | NOT capped | IC track |
| Staff ML Engineer | NOT capped | IC track (high level, no people mgmt) |
| Lead Machine Learning Engineer | NOT capped (default) | "Lead" is usually IC; only cap if JD body explicitly mentions direct reports or hiring authority |
| Principal ML Engineer | NOT capped | IC track (Override 1 may still apply if "Scientist" is also in title) |
| Tech Lead | NOT capped | IC senior |

**Step 3 — Cap can be lifted ONLY by explicit JD body text** confirming the
role is IC-track despite the title:
- "No direct reports"
- "IC track" / "Individual contributor role"
- "Player-coach role with light mentoring only"
- "Hands-on technical role; the [Head/Director/VP] title reflects org scope
  but not people management"

If body text confirms IC, lift cap to a maximum of 4.0. The title alone NEVER
lifts the cap — vague leadership JDs default to capped.

**MANDATORY: Block C must explicitly document the cap decision** with one of:
- "**Org-Leadership Cap Analysis:** CAPPED at 3.0 — title contains [org-leadership word]."
- "**Org-Leadership Cap Analysis:** NOT capped — title is IC-track."
- "**Org-Leadership Cap Analysis:** Cap lifted to 4.0 — JD body says '[exact text]'."

Skipping the Org-Leadership Cap Analysis line in Block C is a calibration failure.

### Override 4: Closed Posting Policy

**Today's date is given in the operating-rules section of the system prompt.**
Compare it against EVERY date appearing in the JD that relates to applications,
submissions, or deadlines.

**Scan the JD text exhaustively for these closure signal patterns:**
- "Applications close [date]" / "Closes [date]" / "Closing date [date]"
- "Apply by [date]" / "Submit by [date]"
- "Deadline: [date]" / "Application deadline: [date]"
- **"Applications will be accepted until [date]"**
- **"Applications accepted at least until [date]"** ← common phrasing
- **"Applications accepted through [date]"**
- "Open until [date]"
- "Last day to apply: [date]"
- "Applications must be received by [date]"
- "We are no longer accepting applications"
- "Position filled" / "Role filled" / "No longer recruiting"
- Any explicit date appearing in the JD body near words like "application",
  "submission", "accept", "deadline", "close", "until", "by", "received"

**Process for ANY date found in the JD:**
1. Identify what the date refers to (posting date? application deadline?
   role start date? interview window?)
2. If the date relates to applications/submissions/deadlines, compare to today
3. If today > that date, the posting is **CLOSED**

**If closed:**
- Block G legitimacy: mark **"Closed/Expired"** with the closure date cited
  (e.g., "Closed since April 12, 2026; today is May 24, 2026")
- Block F: lead with **"POSTING CLOSED ON [date] — EVALUATION PRESERVED FOR REFERENCE, CANNOT APPLY"**
- **Still produce a complete A-G evaluation + SCORE_SUMMARY** — eval data has
  reference value (comp benchmarking, role-pattern matching) even when Dan
  can't apply
- Score normally; closure is captured in Block G, not in the score

**If no closure signal AND no application-related date in JD:** default to
"open" — note "no explicit deadline visible in JD text" in Block G.

### Override 5: Hard SKIP Rules

These produce an effective SKIP regardless of score:

- **JD requires active security clearance** (TS/SCI, Secret, Public Trust) → SKIP
- **JD requires on-site outside Remote / NYC metro / Pittsburgh** → SKIP
- **JD lists base salary below $120K** → SKIP
- **Title triggers Override 1 cap AND no domain match** → strong NOT-recommended (apply only if backup plan)

In Block F, lead with "**Hard SKIP triggered:** [reason]" if any fire.

---

## Target Roles

ML-focused: Machine Learning Engineer, MLOps Engineer, NLP Engineer, Computer Vision
Engineer, Generative AI / LLM Engineer, Data Scientist, Edge AI / Robotics ML,
Research Engineer.

Senior IC is the ceiling. Open to Lead-IC hybrid and to mid-level / Engineer-II
roles at strong-fit companies. Staff / Principal / Distinguished titles are
above the current target band (7 yrs experience) — see Override 2 for cap.

## Archetypes — ML-focused (extend modes/_shared.md)

The system's default archetypes in `modes/_shared.md` cover AI/GenAI roles
(LLMOps, Agentic, AI PM, AI SA, FDE, Transformation Lead). The 8 below extend
coverage to traditional ML, CV, NLP, generative, research, edge, and data science —
which is what Dan actually does.

| Archetype | Thematic axes | What they buy |
|-----------|---------------|---------------|
| **MLOps Engineer** | Training infra, model serving, monitoring, retraining loops, CI/CD for ML, containerization | Someone who runs production ML at scale and keeps it healthy |
| **NLP Engineer** | Document understanding, classification, extraction, RAG, fine-tuning, LLM productionization | Someone who ships text/language ML systems that scale |
| **Computer Vision Engineer** | Image/video ML, detection, segmentation, synthetic data, edge deployment | Someone who ships CV systems from research to production |
| **Generative AI / LLM Engineer** | LLM fine-tuning, RAG, agentic systems, diffusion, GANs, VAEs | Someone who builds with generative models in production |
| **Edge AI / Robotics ML** | Models on resource-constrained hardware, safety-critical inference, real-time ML, robotics stacks | Someone who delivers ML in physical/edge environments |
| **Data Scientist** | Statistical analysis, experimentation, A/B testing, business-driven insight | Someone who turns data into business decisions |
| **Research Engineer** | Paper replication, novel methods, experimentation infra, model evaluation | Someone who bridges research and production |
| **Applied ML Engineer (generalist)** | End-to-end ML across modalities, pragmatic system design, prod ownership | Someone who can ship any ML system end-to-end |

## Adaptive Framing — Mapping Dan's Background to Archetypes

| If the role is... | Emphasize about Dan... | Primary proof points |
|-------------------|------------------------|----------------------|
| **MLOps Engineer** | PNC platform work — first Python app deployment process, first containerized ML pipeline (Kubernetes + Kubeflow), $500K cost reduction, $5.3M annual savings, 40% downtime reduction via TFX | PNC bullets (K8s, Kubeflow, TFX, Docker, CI/CD) |
| **NLP Engineer** | PNC NLP document extraction pipeline, RAG chatbot for internal employee queries, LLM productionization, classification models | PNC NLP + RAG bullets |
| **Computer Vision Engineer** | Four Growers Mask R-CNN tomato picker (20K+ photos, 45% efficiency gain), YOLO/Darknet-53 navigation, synthetic image generation, CV models deployed at PNC | Four Growers CV bullets + PNC CV deployments |
| **Generative AI / LLM Engineer** | PNC RAG chatbot, GANs/VAEs/Latent Diffusion in skill stack, synthetic image generation at Four Growers, LLM serving at scale | RAG chatbot + Four Growers synthetic data work |
| **Edge AI / Robotics ML** | Four Growers robotic harvester labeling system + route planning (33% faster, 10% lower opex), Mujoco/ROS in skill stack, defense-adjacent via Army National Guard | Four Growers robotics + Guard service |
| **Data Scientist** | PNC XGBoost loan rate optimizer, linear regression edge-case analysis (35% reliability gain), data analysis breadth, neuroscience research background | PNC analytical bullets + research roles |
| **Research Engineer** | LLNL neural-interface research, CMU synaptic-transmission classifier (60% accuracy gain via Inception-ResNet), neuroscience degree, 2.5 years of academic research before industry | LLNL + CMU + Pitt education |
| **Applied ML Engineer (generalist)** | "Built PNC's first ML production pipeline" — breadth across NLP/CV/RAG/traditional ML, led team of 60, end-to-end ownership of multiple production systems | PNC overall narrative |

## Cross-cutting Advantage

Frame Dan as **"production-first ML engineer with research-grade rigor"**:

- **Production credibility:** First containerized ML pipeline at a major US bank
  ($5.3M annual savings, $500K cost reduction). Not a researcher writing papers —
  an engineer shipping systems at enterprise scale.
- **Multi-modal range:** NLP, CV, RAG, traditional ML, generative models — all
  deployed to production. Most ML engineers specialize in one modality; Dan ships
  across all of them.
- **Research foundation:** Neuroscience degree (Pitt), two research roles (LLNL,
  CMU CNBC) before industry. Knows when to read the paper vs. when to ship the
  heuristic.
- **Operational leadership:** Led 60-person cross-functional team at PNC (data
  scientists, engineers, vendors, freelancers). Not just IC depth — can run a team.
- **Defense-adjacent:** Army National Guard veteran (Sergeant, 2015-2021). Mission-
  critical thinking, security mindset, eligible for non-clearance defense-adjacent
  work (robotics, dual-use AI). NOT pursuing clearance-required roles.

## Exit Narrative

"Just wrapped 5.5 years at PNC (Aug 2020 – Apr 2026) where I built the bank's
first containerized ML platform from scratch — shipped NLP, CV, RAG, and
traditional ML to production with measurable impact ($5.3M annual savings,
$500K cost reduction, 60% deployment efficiency gain, led a 60-person cross-
functional team). Currently open to work and actively interviewing for ML/MLOps
roles where production rigor and multi-modal breadth translate into real
business outcomes. Strong preference for remote; open to NYC metro or
Pittsburgh in person."

## Location Policy

**Acceptable (in preference order):**
1. Remote (US-eligible)
2. New York, NY metro (commutable from Wallington, NJ)
3. Pittsburgh, PA (relocatable; undergrad alma mater is Pitt)

**Hard NO:**
- On-site requirement in any other city/region
- Hybrid mandates outside the 3 acceptable locations
- Roles requiring active security clearance (TS/SCI, Secret, Public Trust, etc.)

**In evaluations (scoring guidance):**
- Score Block A (location dimension) full credit (5.0) for full remote
- Score 4.0 for hybrid/on-site in NYC metro or Pittsburgh
- Score 1.0–1.5 for anything else — this is an effective SKIP signal
- **Force SKIP in Block F if JD requires security clearance** (see Override 5)

## Comp Targets

- **Base salary floor: $120K** (walk-away below this — on BASE, not total comp)
- **Target range:** $140K–180K base, depending on seniority signaling in the JD
- Equity / RSUs / bonus are welcome upside but do NOT compensate for sub-floor base
- Contractor / 1099 rates: floor scales to ~$80/hr or higher (≈30-50% premium over W-2 equivalent)

## Negotiation Scripts

**Salary expectations:**
> "Based on market data for Senior ML Engineer roles in NY/Pittsburgh/Remote, I'm
> targeting $140K-180K base. I'm flexible on structure — total package and growth
> trajectory matter more than any single line item."

**Geographic discount pushback:**
> "The roles I'm competitive for are output-based, not location-based. My PNC
> production track record doesn't change based on my home address."

**When offered below floor:**
> "I'm comparing with opportunities in the $140K+ range. I'm drawn to [company]
> because of [specific reason]. Can we get the base to at least $140K?"

**On security clearance asks:**
> "I'm not pursuing clearance-required roles. Happy to discuss any unclassified
> work or dual-use applications if the scope allows."

## Portfolio / Demo

- LinkedIn: linkedin.com/in/daniel--garcia
- GitHub: (TBD — add public repos as they become shareable)
- No public demos yet — most production work is at PNC and not open-sourceable

## Notes for the Evaluator

- **Veteran status is an asset for some employers** — surface in Block E (Customization)
  when the JD mentions veterans, diversity, or government-adjacent customers
- **Neuroscience degree is uncommon for ML roles** — surface as a differentiator
  in Block C (Level/Strategy) for research-adjacent or healthcare/biotech roles
- All hard SKIP conditions (clearance, location, comp, scientist-tier titles) are
  enforced via the MANDATORY OVERRIDES section at the top — refer to those rules
  when explaining recommendations

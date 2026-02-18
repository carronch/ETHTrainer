# AI Project Setup — Interview Prompt

> Paste everything below this line to Claude or Gemini at the start of a new project.
> The AI will ask you questions and generate a ready-to-use CLAUDE.md.

---

I need you to help me set up a new project. Please interview me by asking the questions below **one section at a time** — wait for my answer before moving to the next section. Once you have all my answers, generate a complete `CLAUDE.md` file I can drop into my project root.

Ask me these sections in order:

---

**Section 1 — The Project**
- What is the name of this project?
- Describe what it does in 1–2 sentences. Who uses it and what problem does it solve?

---

**Section 2 — The Stack**
- What is the frontend? (e.g. React, Astro, plain HTML, none)
- What is the backend? (e.g. Cloudflare Workers, Node, Python, none)
- What database are you using, if any? (e.g. Cloudflare D1, Postgres, none)
- Any other key libraries or services? (e.g. Tailwind, Stripe, Auth)

---

**Section 3 — Commands**
- How do you start local development?
- How do you deploy?
- How do you run tests, if any?
- Are there any scripts in the `scripts/` folder I should know about?

---

**Section 4 — Architecture**
- What are the most important files or folders I should know before touching anything?
- Are there any patterns or conventions I must follow? (e.g. file naming, folder structure)
- Is there anything I should NEVER do in this project?

---

**Section 5 — Secrets & Environment**
- What environment variables or secrets does this project need? (names only, no values)
- Where do they go? (.dev.vars, .env, Cloudflare secrets)

---

**Section 6 — Deployment**
- Where does this project deploy? (e.g. Cloudflare Workers, Pages, both)
- Is deployment automated via GitHub Actions or manual via CLI?
- What is the production URL, if known?

---

Once I answer all sections, generate the CLAUDE.md using this format:

```
# [Project Name]

> [One-line description]

## What It Does
[2–3 sentences]

## Stack
- **Frontend:** ...
- **Backend:** ...
- **Database:** ...
- **Other:** ...

## Commands
\`\`\`bash
# Local dev
...

# Deploy
...

# Scripts
...
\`\`\`

## Architecture
[Key files, patterns, conventions]

## Secrets
[List of env var names and where they live]

## Deployment
[Where, how, URL]

## Rules
- [Things I must not do]
- [Conventions to follow]
```

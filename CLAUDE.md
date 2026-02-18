# Project

> Replace this with a one-line description of the project.
> Tip: paste `docs/ai-setup-prompt.md` to Claude or Gemini and it will interview you and generate this file.

## Stack

- **Frontend:** <!-- e.g. React, plain HTML -->
- **Backend:** <!-- e.g. Cloudflare Workers, Node -->
- **Database:** <!-- e.g. Cloudflare D1, none -->
- **Deployment:** Cloudflare

## Commands

```bash
# Install dependencies
npm install

# Local development
npm run dev

# Deploy to Cloudflare
npm run deploy

# Run scripts manually
node scripts/<script-name>.js
```

## Architecture

> Describe the key structure decisions here. What are the main pieces and how do they connect?

## Key Files

> List files Claude should pay attention to before making changes.

- `wrangler.toml` — Cloudflare configuration
- `src/index.js` — main entry point

## Rules

- Do not commit `.env` or `.dev.vars`
- Do not add external automation tools — put scripts in `scripts/`
- Keep dependencies minimal
- Deploy only via CLI or CI, never the dashboard

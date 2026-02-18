# Project Name

> One-line description.

## Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd <project>
npm install

# 2. Activate git hooks (run once per machine)
git config core.hooksPath .githooks

# 3. Set up local secrets (Cloudflare Workers dev)
cp .dev.vars.example .dev.vars
# fill in .dev.vars with your values

# 4. Run locally
npm run dev          # starts at http://localhost:8787
```

## Deploy

```bash
# Deploy to Cloudflare (manual)
npm run deploy

# Or push to main — GitHub Actions deploys automatically
git push origin main
```

## Secrets

Secrets are never stored in files. Set them per environment:

```bash
# Production (Cloudflare)
wrangler secret put SECRET_NAME

# Local dev — edit .dev.vars (gitignored)
```

## Scripts

On-demand backend tasks live in `scripts/`. Run them locally:

```bash
node scripts/<script-name>.js
```

## Docs

- [`docs/spec.md`](docs/spec.md) — planning template for new features
- [`CLAUDE.md`](CLAUDE.md) — context for Claude Code
- [`wrangler.toml`](wrangler.toml) — Cloudflare configuration

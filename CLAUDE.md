# Project

> One-line description of the project.
> Tip: paste `docs/ai-setup-prompt.md` to Claude or Gemini and it will interview you and generate this file.

## Workflow Orchestration
### Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### Self-Improvement Loop

- After ANY correction from the user: update tasks/lessons.md with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

- Plan First: Write plan to tasks/todo.md with checkable items
- Verify Plan: Check in before starting implementation
- Track Progress: Mark items complete as you go
- Explain Changes: High-level summary at each step
- Document Results: Add review section to tasks/todo.md
- Capture Lessons: Update tasks/lessons.md after corrections

## Core Principles

- Simplicity First: Make every change as simple as possible. Impact minimal code.
- No Laziness: Find root causes. No temporary fixes. Senior developer standards.
- Minimal Impact: Changes should only touch what's necessary. Avoid introducing bugs.

## Stack

- **Frontend:** <!-- e.g. Astro + Tailwind, React, plain HTML -->
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

> List files the AI should pay attention to before making changes.

- `wrangler.toml` — Cloudflare configuration
- `src/index.js` — main entry point

## Rules

- Do not commit `.env` or `.dev.vars`
- Don't use localStorage (use Cloudflare KV or D1 instead)
- Don't hardcode API keys
- Do not add external automation tools — put scripts in `scripts/`
- Keep dependencies minimal
- Don't create huge monolithic components
- Deploy only via CLI or CI, never the dashboard

## Coding Rules
### For Astro (remove if not using Astro)

- One component = one responsibility (Nav, Hero, Features, CTA, Footer — never merge them)
- Data and logic go in frontmatter (---), markup below
- Avoid JavaScript unless strictly necessary — Astro is HTML-first
- New page = new file in src/pages/. That's it, no router config needed
- Always wrap pages with <BaseLayout> from src/layouts/BaseLayout.astro

### Tailwind + CSS (remove if not using Tailwind)

- Use Tailwind for layout, spacing, and responsive breakpoints
- Use CSS variables from global.css for brand colors and fonts — never hardcode hex values
- Never use style="" attributes except for animation-delay staggering
- Mobile-first: always write sm: / md: / lg: variants

### Frontend Design Standards
- ⚠️ This section is critical. Apply it every time you touch UI.
- The Prime Directive
- Never produce generic AI-looking UI. Every interface must have a clear,
- committed aesthetic point-of-view. "Clean and modern" is not an aesthetic.
- Choose a direction and execute it with precision.
- Before writing any UI code, answer these three questions:

### What is the aesthetic direction?
- Pick one: brutally minimal / maximalist / retro-futuristic / organic / luxury /
editorial / brutalist / art-deco / soft-pastel / industrial / playful / dark-tech
- then commit fully. Do not blend without intention.

### What makes this component UNFORGETTABLE?
- One thing. Nail it. Everything else supports it.
- Does every detail serve the direction?
- Spacing, font weight, border radius, color — nothing is default.

### Typography

- Always pair a distinctive display font with a refined body font
- Banned fonts: Inter, Roboto, Arial, system-ui, Space Grotesk, Helvetica
- Good display choices (pick based on aesthetic): Fraunces, Cabinet Grotesk,
Bebas Neue, Cormorant Garamond, Syne, Clash Display, Neue Haas Grotesk,
Editorial New, Instrument Serif, PP Mondwest
- Good body choices: DM Sans, Söhne, Switzer, General Sans, Satoshi
- Font size hierarchy must be dramatic — headings should feel large, body text calm
- Use font-display and font-body CSS variables, never hardcode font names in components

### Color

- Pick a dominant color and one sharp accent. Two colors > six colors.
- Dark backgrounds are often more striking than light ones — don't default to white
- Avoid: purple-on-white, blue-on-white, generic SaaS teal
- Use CSS custom properties: --color-brand-* tokens in global.css
- Gradients: use sparingly and purposefully — gradient mesh or noise overlay > generic linear

### Layout & Composition

- Break the grid intentionally — asymmetry, overlapping elements, diagonal flow
- Generous negative space OR controlled density — pick one, not the muddy middle
- Hero sections: avoid centered text + button on white — try offset layouts, oversized
type, full-bleed imagery, or text that bleeds off screen
- Feature grids: 3-col is the last resort. Try alternating rows, large + small mixed,
horizontal scrollers, or a single spotlight layout

### Motion & Interaction

- Page load: one orchestrated staggered reveal is worth more than 10 scattered animations
- Hover states must feel considered — not just opacity-80. Try: scale + shadow,
color shift, underline draw, border reveal, background slide
- CSS-only animations preferred. Use @keyframes in global.css
- Do NOT add animation just to add animation — every motion must have a reason

### Backgrounds & Texture

- Flat white/gray backgrounds are the enemy. Add depth:
- Noise texture overlay (SVG filter or CSS)
- Gradient mesh
- Subtle geometric pattern
- Layered transparency with backdrop-filter
- Grain overlay via ::before pseudo-element
- Shadows: use layered, colored shadows over box-shadow: 0 4px 6px rgba(0,0,0,0.1)

### What "Production-Grade" Means Here

- Every component works on mobile, tablet, and desktop
- Images use Astro's <Image> component for optimization
- Interactive elements have visible focus states (accessibility)
- Text contrast passes WCAG AA minimum
- No layout shift on load

### When I Ask You to Build a Component

- State your aesthetic direction out loud before writing code
- Justify the font pairing choice
- Write the complete .astro file — no partial snippets
- Include responsive variants for all breakpoints
- Show the import line to add it to index.astro
- Flag any new npm packages needed

## Current focus / active work

<!-- Update this regularly so the AI knows what you're working on -->

## Known issues / constraints

<!-- List any known bugs or limitations the AI should be aware of -->

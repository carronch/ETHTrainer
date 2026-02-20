import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { BaseAgent } from './base.js'
import type { Tool } from '../llm/index.js'
import { upsertStrategy, getStrategy } from '../db/queries.js'

// ── Load Obsidian vault ───────────────────────────────────────────────────────

function loadObsidianVault(vaultPath: string): string {
  if (!vaultPath || !existsSync(vaultPath)) {
    console.warn('[MungerAgent] Obsidian vault not found at:', vaultPath)
    return '(No Obsidian vault loaded — operating on built-in mental models only.)'
  }

  const notes: string[] = []

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.')) continue
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        walk(fullPath)
      } else if (extname(entry) === '.md') {
        const content = readFileSync(fullPath, 'utf8').trim()
        if (content) {
          notes.push(`## ${entry.replace('.md', '')}\n\n${content}`)
        }
      }
    }
  }

  walk(vaultPath)
  return notes.join('\n\n---\n\n')
}

// ── MungerAgent ───────────────────────────────────────────────────────────────

const MUNGER_SYSTEM_PROMPT = (vaultContent: string) => `
You are the MungerAgent — the strategic advisor for the ETHTrainer system.

You think like Charlie Munger: a lifelong learner with mastery across many disciplines,
a ruthless clarity of thought, and an obsessive focus on avoiding mistakes.

Your job is NOT to find opportunities. Your job is to KILL bad ideas before capital is deployed.
You are the last line of defense before a strategy gets approved.

## Your Mental Models (always apply these)

1. **Inversion** — Before asking "how do we win?", ask "how do we lose?" and avoid that.
2. **Circle of Competence** — Is this strategy within our demonstrated competence? If not, say so.
3. **Margin of Safety** — If the math only works in ideal conditions, reject it.
4. **First Principles** — Strip away the narrative. What is actually happening?
5. **Lollapalooza Effect** — Multiple forces acting together amplify outcomes. Identify them.
6. **Survivorship Bias** — A backtest that looks good may be showing you the survivors.
7. **Mr. Market** — The market is often irrational short-term. Don't fight it, use it.
8. **Opportunity Cost** — What else could we do with this capital and time?
9. **Avoid Envy and Urgency** — If a strategy feels urgent, that is a red flag.
10. **Think in Base Rates** — What is the real historical win rate for strategies like this?

## Your Obsidian Vault (personal notes and mental models)

${vaultContent}

## Output Format

When evaluating a strategy, always structure your response as:

### Verdict: APPROVED | REJECTED | NEEDS MORE RESEARCH

### Inversion Analysis
What are the ways this fails?

### Circle of Competence
Do we understand this well enough to act?

### Margin of Safety
What are the assumptions? What breaks them?

### Key Risks
List the top 3 risks in order of severity.

### Recommendation
Clear, direct, actionable.

Be brutal. A bad idea killed early saves capital and time.
`.trim()

const MUNGER_TOOLS: Tool[] = [
  {
    name: 'record_strategy_decision',
    description: 'Record the Munger evaluation decision for a strategy in the database.',
    inputSchema: {
      type: 'object',
      properties: {
        strategy_name: { type: 'string', description: 'Name of the strategy being evaluated' },
        verdict: { type: 'string', enum: ['APPROVED', 'REJECTED', 'NEEDS_MORE_RESEARCH'] },
        confidence: { type: 'number', description: 'Confidence in the strategy 0.0-1.0 (only if approved)' },
        notes: { type: 'string', description: 'Full evaluation notes to store' },
      },
      required: ['strategy_name', 'verdict', 'notes'],
    },
    execute: async (input) => {
      const verdict = input.verdict as string
      const approved = verdict === 'APPROVED'
      const existing = getStrategy(input.strategy_name as string)

      upsertStrategy({
        name: input.strategy_name as string,
        description: existing?.description,
        status: approved ? (existing?.status ?? 'backtesting') : 'paused',
        confidence: (input.confidence as number) ?? (approved ? 0.6 : 0.0),
        approved_by_munger: approved ? 1 : 0,
        munger_notes: input.notes as string,
      })

      return { saved: true, verdict }
    },
  },
]

export class MungerAgent extends BaseAgent {
  constructor(obsidianVaultPath?: string) {
    const vaultContent = loadObsidianVault(obsidianVaultPath ?? '')

    super({
      name: 'munger',
      systemPrompt: MUNGER_SYSTEM_PROMPT(vaultContent),
      tools: MUNGER_TOOLS,
      provider: 'claude',
      model: 'claude-opus-4-6',
    })
  }

  /**
   * Evaluate a strategy proposal. Returns the full evaluation as text
   * and saves the verdict to the database.
   */
  async evaluate(strategyName: string, strategyDescription: string): Promise<string> {
    this.log('decision', `Evaluating strategy: ${strategyName}`)
    const prompt = `
Please evaluate the following Ethereum trading strategy:

**Strategy Name:** ${strategyName}

**Description:**
${strategyDescription}

Apply all your mental models. Record your decision using the record_strategy_decision tool.
`.trim()

    return this.runOnce(prompt)
  }
}

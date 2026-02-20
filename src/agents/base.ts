import { chat, type Message, type Tool, type ChatOptions, type LLMProvider } from '../llm/index.js'
import { logAgent } from '../db/queries.js'

export interface AgentOptions {
  name: string
  systemPrompt: string
  tools?: Tool[]
  provider?: LLMProvider
  model?: string
  maxTokens?: number
}

/**
 * Base agent class — wraps the LLM tool-calling loop with:
 * - Persistent conversation history (within a session)
 * - Automatic logging to SQLite
 * - Spawning sub-agents
 */
export abstract class BaseAgent {
  protected name: string
  protected systemPrompt: string
  protected tools: Tool[]
  protected provider: LLMProvider
  protected model?: string
  protected maxTokens?: number
  protected history: Message[] = []

  constructor(opts: AgentOptions) {
    this.name = opts.name
    this.systemPrompt = opts.systemPrompt
    this.tools = opts.tools ?? []
    this.provider = opts.provider ?? 'claude'
    this.model = opts.model
    this.maxTokens = opts.maxTokens
  }

  async run(userMessage: string): Promise<string> {
    this.log('info', `Running: ${userMessage.slice(0, 120)}`)

    this.history.push({ role: 'user', content: userMessage })

    const result = await chat(
      this.systemPrompt,
      this.history,
      this.tools,
      {
        provider: this.provider,
        model: this.model,
        maxTokens: this.maxTokens,
      } as ChatOptions & { provider: LLMProvider },
    )

    this.history.push({ role: 'assistant', content: result.content })

    this.log('info', `Done. Tokens: ${result.inputTokens}in/${result.outputTokens}out`)

    return result.content
  }

  /**
   * Run the agent with a fresh conversation (no history).
   * Use for one-shot evaluations.
   */
  async runOnce(userMessage: string): Promise<string> {
    this.clearHistory()
    return this.run(userMessage)
  }

  clearHistory(): void {
    this.history = []
  }

  protected log(level: 'info' | 'warn' | 'error' | 'decision', message: string, metadata?: unknown): void {
    const prefix = `[${this.name}]`
    if (level === 'error') {
      console.error(prefix, message)
    } else {
      console.log(prefix, message)
    }
    logAgent(this.name, level, message, metadata)
  }

  /**
   * Create a tool that delegates to another agent.
   * This is how the master agent spawns specialized sub-agents.
   */
  static makeDelegateTool(agent: BaseAgent, toolName: string, description: string): Tool {
    return {
      name: toolName,
      description,
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The task to delegate to this agent' },
        },
        required: ['task'],
      },
      execute: async (input) => {
        const result = await agent.runOnce(input.task as string)
        return { result }
      },
    }
  }
}

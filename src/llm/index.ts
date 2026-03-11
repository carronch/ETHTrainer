import Anthropic from '@anthropic-ai/sdk'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>   // JSON Schema object
  execute: (input: Record<string, unknown>) => Promise<unknown>
}

export interface ChatOptions {
  model?: string
  maxTokens?: number
  temperature?: number
}

export interface ChatResult {
  content: string
  model: string
  inputTokens: number
  outputTokens: number
}

// ── Claude client ─────────────────────────────────────────────────────────────

let _anthropic: Anthropic | null = null

function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _anthropic
}

async function chatClaude(
  systemPrompt: string,
  messages: Message[],
  tools: Tool[],
  opts: ChatOptions,
): Promise<ChatResult> {
  const client = getAnthropic()
  const model = opts.model ?? 'claude-opus-4-6'

  const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
  }))

  const history: Anthropic.MessageParam[] = messages.map(m => ({
    role: m.role,
    content: m.content,
  }))

  // Tool-calling loop
  let finalText = ''
  let totalInput = 0
  let totalOutput = 0

  while (true) {
    const response = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 4096,
      system: systemPrompt,
      messages: history,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    })

    totalInput += response.usage.input_tokens
    totalOutput += response.usage.output_tokens

    // Collect text from this response
    const textBlocks = response.content.filter(b => b.type === 'text')
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')

    if (textBlocks.length > 0) {
      finalText = textBlocks.map(b => (b as Anthropic.TextBlock).text).join('\n')
    }

    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      break
    }

    // Execute tool calls and feed results back
    history.push({ role: 'assistant', content: response.content })

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of toolUseBlocks) {
      const toolUse = block as Anthropic.ToolUseBlock
      const tool = tools.find(t => t.name === toolUse.name)
      let result: unknown
      if (!tool) {
        result = { error: `Unknown tool: ${toolUse.name}` }
      } else {
        try {
          result = await tool.execute(toolUse.input as Record<string, unknown>)
        } catch (err) {
          result = { error: String(err) }
        }
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      })
    }

    history.push({ role: 'user', content: toolResults })
  }

  return { content: finalText, model, inputTokens: totalInput, outputTokens: totalOutput }
}

// ── Unified chat function ─────────────────────────────────────────────────────

export async function chat(
  systemPrompt: string,
  messages: Message[],
  tools: Tool[] = [],
  opts: ChatOptions = {},
): Promise<ChatResult> {
  return chatClaude(systemPrompt, messages, tools, opts)
}

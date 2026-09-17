import { type AssistantMessageContent, type ToolParamName, type ToolUse, type ToolUseName } from '.'
import { getToolMetadata } from '../task/tool-registry'
import { parseAssistantMessageV2 } from './parse-assistant-message'

export interface ParsedAssistantMessage {
  content: AssistantMessageContent[]
  /** Pending/malformed control frames must be repaired, never treated as completion. */
  protocolError?: string
}

// Gateways may emit model-native DSML in delta.content instead of tool_calls.
// Parse only complete envelopes and keep parameter bodies opaque: shell syntax,
// XML in files, and JSON arguments are data, not more tool calls.
const marker = '[｜|]{2}DSML[｜|]{2}'
const callsOpen = new RegExp(`<${marker}\\s+calls\\s*>`, 'g')
const callsClose = new RegExp(`</${marker}\\s+calls\\s*>`, 'g')
const invokeOpen = new RegExp(`<${marker}\\s+invoke\\s+name="([a-zA-Z_][\\w]*)"\\s*>`, 'y')
const invokeClose = new RegExp(`</${marker}\\s+invoke\\s*>`, 'y')
const paramOpen = new RegExp(`<${marker}\\s+parameter\\s+name="([a-zA-Z_][\\w]*)"(?:\\s+string="(?:true|false)")?\\s*>`, 'y')
const paramClose = new RegExp(`</${marker}\\s+parameter\\s*>`, 'g')
const dsmlControl = /<\/?[｜|]{1,2}(?:DSML)?/

function parseCalls(body: string): ToolUse[] {
  const tools: ToolUse[] = []
  let offset = 0
  const skipSpace = () => {
    while (/\s/.test(body[offset] ?? '') && offset < body.length) offset++
  }
  skipSpace()
  while (offset < body.length) {
    invokeOpen.lastIndex = offset
    const invoke = invokeOpen.exec(body)
    if (!invoke) throw new Error('Invalid tool invocation')
    const name = invoke[1] as ToolUseName
    const metadata = getToolMetadata(name)
    if (!metadata) throw new Error('Unknown tool name')
    const tool: ToolUse = { type: 'tool_use', name, params: {}, partial: false, format: 'dsml' }
    offset = invokeOpen.lastIndex
    while (true) {
      skipSpace()
      invokeClose.lastIndex = offset
      if (invokeClose.exec(body)) {
        offset = invokeClose.lastIndex
        break
      }
      paramOpen.lastIndex = offset
      const param = paramOpen.exec(body)
      if (!param) throw new Error('Invalid tool parameter')
      const key = param[1] as ToolParamName
      if (!metadata.paramNames.includes(key) || Object.hasOwn(tool.params, key)) {
        throw new Error('Unknown or duplicate tool parameter')
      }
      paramClose.lastIndex = paramOpen.lastIndex
      const closing = paramClose.exec(body)
      if (!closing) throw new Error('Unterminated tool parameter')
      tool.params[key] = body.slice(paramOpen.lastIndex, closing.index).trim()
      offset = paramClose.lastIndex
    }
    tools.push(tool)
    skipSpace()
  }
  if (!tools.length) throw new Error('Empty tool envelope')
  return tools
}

/** Shared boundary for every provider; the normal dispatcher still owns policy/approval. */
export function parseAssistantMessageWithProtocol(message: string): ParsedAssistantMessage {
  // Quoted protocol examples are prose, not invocations. Preserve offsets while
  // hiding them from control-frame discovery (including an unfinished fence).
  const controls = message.replace(/```[^]*?(?:```|$)|~~~[^]*?(?:~~~|$)|`[^`\n]*`/g, (quoted) => ' '.repeat(quoted.length))
  const content: AssistantMessageContent[] = []
  let offset = 0
  while (offset < message.length) {
    callsOpen.lastIndex = offset
    const opening = callsOpen.exec(controls)
    if (!opening) {
      const tail = message.slice(offset)
      const control = dsmlControl.exec(controls.slice(offset))
      // A DSML-looking string inside an XML tool parameter is ordinary data.
      if (control && parseAssistantMessageV2(tail.slice(0, control.index)).at(-1)?.type === 'tool_use') {
        content.push(...parseAssistantMessageV2(tail))
        return { content }
      }
      content.push(...parseAssistantMessageV2(control ? tail.slice(0, control.index) : tail))
      return { content, protocolError: control ? 'Incomplete or unsupported tool envelope' : undefined }
    }
    const prefix = parseAssistantMessageV2(message.slice(offset, opening.index))
    if (prefix.at(-1)?.type === 'tool_use' && prefix.at(-1)?.partial) {
      content.push(...parseAssistantMessageV2(message.slice(offset)))
      return { content }
    }
    callsClose.lastIndex = callsOpen.lastIndex
    const closing = callsClose.exec(message)
    if (!closing) {
      content.push(...prefix)
      return { content, protocolError: 'Incomplete tool envelope' }
    }
    let tools: ToolUse[]
    try {
      tools = parseCalls(message.slice(callsOpen.lastIndex, closing.index))
    } catch (error) {
      content.push(...prefix)
      return { content, protocolError: (error as Error).message }
    }
    // A following tool terminates preceding prose, but never closes partial XML.
    for (const block of prefix) if (block.type === 'text') block.partial = false
    content.push(...prefix, ...tools)
    offset = callsClose.lastIndex
  }
  return { content }
}

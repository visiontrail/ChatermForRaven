import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getGlobalStateMock } = vi.hoisted(() => ({
  getGlobalStateMock: vi.fn(async () => ({}))
}))

vi.mock('electron', () => ({
  app: { getAppPath: () => '' },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: vi.fn(), on: vi.fn(), once: vi.fn(), removeAllListeners: vi.fn() },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) }
}))

vi.mock('@storage/db/chaterm.service', () => ({
  ChatermDatabaseService: { getInstance: vi.fn(async () => ({})) }
}))
vi.mock('@storage/database', () => ({ connectAssetInfo: vi.fn(async () => undefined) }))
vi.mock('../../../../ssh/agentHandle', () => ({
  remoteSshConnect: vi.fn(),
  remoteSshDisconnect: vi.fn(),
  isWakeupSession: vi.fn().mockReturnValue(false),
  openWakeupShell: vi.fn(),
  findWakeupConnectionInfoByHost: vi.fn().mockReturnValue(null)
}))
vi.mock('@integrations/remote-terminal', () => ({
  RemoteTerminalManager: class {
    disposeAll = vi.fn()
  }
}))
vi.mock('@integrations/local-terminal', () => ({
  LocalTerminalManager: class {},
  LocalCommandProcess: class {}
}))
vi.mock('@services/telemetry/TelemetryService', () => ({ telemetryService: { captureTaskFeedback: vi.fn() } }))
vi.mock('@api/index', () => ({
  ApiHandler: class {},
  buildApiHandler: vi.fn(() => ({}))
}))
vi.mock('@core/storage/state', () => ({
  getGlobalState: getGlobalStateMock,
  getUserConfig: vi.fn(async () => ({}))
}))
vi.mock('@core/prompts/responses', () => ({
  getFormatResponse: () => ({
    toolError: (msg: string) => `ERR:${msg}`,
    toolAlreadyUsed: (name: string) => `USED:${name}`
  })
}))

import { Task } from '../index'
import { parseAssistantMessageWithProtocol } from '../../assistant-message'

describe('Task dispatch and state flow', () => {
  let task: any

  beforeEach(() => {
    vi.clearAllMocks()
    getGlobalStateMock.mockResolvedValue({})

    task = Object.create((Task as unknown as { prototype: object }).prototype) as any
    task.taskId = 'task-test'
    task.userMessageContent = []
    task.chatermMessages = []
    task.pendingToolResults = []
    task.userMessageContentReady = true

    task.say = vi.fn().mockResolvedValue(undefined)
    task.saveCheckpoint = vi.fn().mockResolvedValue(undefined)
    task.getToolDescription = vi.fn(() => '[mock-tool]')
    task.addTodoStatusUpdateReminder = vi.fn().mockResolvedValue(undefined)
    task.setNextUserInputContentParts = vi.fn()
    task.truncateHistoryAtTimestamp = vi.fn().mockResolvedValue(undefined)
    task.addToApiConversationHistory = vi.fn().mockResolvedValue(undefined)
    task.recursivelyMakeChatermRequests = vi.fn().mockResolvedValue(true)
    task.handleEmptyAssistantResponse = vi.fn().mockResolvedValue(false)

    task.handleExecuteCommandToolUse = vi.fn().mockResolvedValue(undefined)
    task.handleAskFollowupQuestionToolUse = vi.fn().mockResolvedValue(undefined)
    task.handleTodoWriteToolUse = vi.fn().mockResolvedValue(undefined)
    task.handleTodoReadToolUse = vi.fn().mockResolvedValue(undefined)
    task.handleGrepSearchToolUse = vi.fn().mockResolvedValue(undefined)
    task.responseFormatter = {
      toolError: (msg: string) => `ERR:${msg}`,
      toolAlreadyUsed: (name: string) => `USED:${name}`,
      toolDenied: () => 'Denied.',
      toolResult: (msg: string) => msg,
      noToolsUsed: () => 'No tools used.',
      tooManyMistakes: (msg: string) => `Too many mistakes: ${msg}`
    }
  })

  it('preserves stream completion time when delayed usage arrives', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(12340)
    try {
      task.chatermMessages = [{ say: 'api_req_started', ts: 1000, text: '{}' }]
      task.api = { getModel: () => ({ id: 'served-model', info: { contextWindow: 10000 } }) }
      const metrics = { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0, totalCost: 0 }
      const updater = task.createMessageUpdater(metrics)
      updater.updateApiReqMsg()
      expect(JSON.parse(task.chatermMessages[0].text)).toMatchObject({ completedAt: 12340, modelId: 'served-model' })
      clock.mockReturnValue(30000)
      metrics.outputTokens = 50
      updater.updateApiReqMsg()
      expect(JSON.parse(task.chatermMessages[0].text)).toMatchObject({ completedAt: 12340, tokensOut: 50 })
    } finally {
      clock.mockRestore()
    }
  })

  it('handleWebviewAskResponse should persist payload and apply truncation', async () => {
    const contentParts = [{ type: 'chip', chipType: 'doc' }]
    const toolResult = { output: 'ls output', toolName: 'execute_command' }
    await task.handleWebviewAskResponse('yesButtonClicked', 'ok', 12345, contentParts, toolResult)

    expect(task.truncateHistoryAtTimestamp).toHaveBeenCalledWith(12345)
    expect(task.setNextUserInputContentParts).toHaveBeenCalledWith(contentParts)
    expect(task.askResponsePayload).toEqual({
      response: 'yesButtonClicked',
      text: 'ok',
      contentParts,
      toolResult
    })
  })

  it('handleToolUse should block tool execution in chat mode', async () => {
    getGlobalStateMock.mockResolvedValue({ mode: 'chat' })

    await task.handleToolUse({
      name: 'execute_command',
      params: { command: 'ls' },
      partial: false
    })

    expect(task.say).toHaveBeenCalledWith(
      'error',
      'Chat mode does not support tool execution. This mode is for conversation, learning, and brainstorming only.',
      false
    )
    expect(task.saveCheckpoint).toHaveBeenCalledTimes(1)
    expect(task.handleExecuteCommandToolUse).not.toHaveBeenCalled()
    expect(task.userMessageContent[0].text).toContain('ERR:Chat mode does not support tool execution')
  })

  it('handleToolUse should skip after previous rejection and keep reason text', async () => {
    task.didRejectTool = true
    await task.handleToolUse({ name: 'grep_search', params: { query: 'abc' }, partial: true })

    expect(task.handleGrepSearchToolUse).not.toHaveBeenCalled()
    expect(task.userMessageContent[0].text).toContain('interrupted and not executed')
  })

  it('handleToolUse should reject second non-todo tool in same turn', async () => {
    task.didAlreadyUseTool = true
    await task.handleToolUse({ name: 'grep_search', params: { query: 'abc' }, partial: false })

    expect(task.handleGrepSearchToolUse).not.toHaveBeenCalled()
    expect(task.userMessageContent[0].text).toBe('USED:grep_search')
  })

  it('handleToolUse should still allow todo tool after another tool', async () => {
    task.didAlreadyUseTool = true
    await task.handleToolUse({ name: 'todo_write', params: {}, partial: false })

    expect(task.handleTodoWriteToolUse).toHaveBeenCalledTimes(1)
  })

  it('handleToolUse should ignore unsupported partial tool call', async () => {
    await task.handleToolUse({ name: 'grep_search', params: { query: 'a' }, partial: true })
    expect(task.handleGrepSearchToolUse).not.toHaveBeenCalled()
  })

  it('handleToolUse should dispatch execute_command and append todo reminder', async () => {
    await task.handleToolUse({ name: 'execute_command', params: { command: 'pwd' }, partial: false })

    expect(task.handleExecuteCommandToolUse).toHaveBeenCalledTimes(1)
    expect(task.addTodoStatusUpdateReminder).toHaveBeenCalledWith('')
  })

  it('handleToolUse should not append todo reminder for ask_followup_question', async () => {
    await task.handleToolUse({
      name: 'ask_followup_question',
      params: { question: 'next?', options: '["a"]' },
      partial: false
    })

    expect(task.handleAskFollowupQuestionToolUse).toHaveBeenCalledTimes(1)
    expect(task.addTodoStatusUpdateReminder).not.toHaveBeenCalled()
  })

  it('processAssistantResponse should use empty response handler', async () => {
    const result = await task.processAssistantResponse('')
    expect(task.handleEmptyAssistantResponse).toHaveBeenCalledTimes(1)
    expect(result).toBe(false)
  })

  it('processAssistantResponse should save message and recurse for non-empty response', async () => {
    const result = await task.processAssistantResponse('assistant text')

    expect(task.addToApiConversationHistory).toHaveBeenCalledWith({
      role: 'assistant',
      content: [{ type: 'text', text: 'assistant text' }]
    })
    expect(task.recursivelyMakeChatermRequests).toHaveBeenCalledWith(task.userMessageContent)
    expect(result).toBe(true)
  })

  it.each([
    '<execute_command><ip>test-device</ip><requires_approval>false</requires_approval><command>printf cut',
    '<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="execute_command">'
  ])('requests repair without executing truncated calls or reporting completion', async (text) => {
    task.resetStreamingState()
    task.consecutiveMistakeCount = 0
    task.didCompleteReadingStream = true
    task.hosts = [{ host: 'test-device' }]
    task.ask = vi.fn()
    const parsed = parseAssistantMessageWithProtocol(text)
    task.assistantMessageContent = parsed.content
    task.assistantMessageProtocolError = parsed.protocolError
    await task.finalizePartialBlocks()
    await vi.waitFor(() => expect(task.userMessageContentReady).toBe(true))
    expect(task.handleExecuteCommandToolUse).not.toHaveBeenCalled()
    expect(task.ask).not.toHaveBeenCalled()
    expect(task.userMessageContent[0].text).toContain('[Tool protocol error]')
    expect(task.consecutiveMistakeCount).toBe(1)
  })

  it('advances an execution task after prose instead of silently waiting for the user', async () => {
    task.hosts = [{ host: 'test-device' }]
    task.consecutiveMistakeCount = 0
    task.currentStreamingContentIndex = 0
    task.assistantMessageContent = [{ type: 'text', content: 'I will inspect the logs.', partial: false }]
    task.ask = vi.fn()
    await task.handleTextBlock(task.assistantMessageContent[0])
    expect(task.ask).not.toHaveBeenCalled()
    expect(task.userMessageContent).toEqual([{ type: 'text', text: 'No tools used.' }])
    expect(task.consecutiveMistakeCount).toBe(1)
  })

  it.each(['chat', 'no-host'])('preserves conversational completion for %s', async (mode) => {
    getGlobalStateMock.mockResolvedValue({ mode: mode === 'chat' ? 'chat' : 'agent' })
    task.hosts = mode === 'chat' ? [{ host: 'test-device' }] : []
    task.currentStreamingContentIndex = 0
    task.assistantMessageContent = [{ type: 'text', content: 'Explanation.', partial: false }]
    task.ask = vi.fn().mockResolvedValue({ response: 'yesButtonClicked' })
    await task.handleTextBlock(task.assistantMessageContent[0])
    expect(task.ask).toHaveBeenCalledWith('completion_result', '', false)
    expect(task.userMessageContent).toEqual([])
  })

  it('bounds repeated protocol/no-tool repairs with the existing mistake limit', async () => {
    task.consecutiveMistakeCount = 3
    task.autoApprovalSettings = { enabled: false }
    task.api = { getModel: () => ({ id: 'test' }) }
    task.messages = { consecutiveMistakesErrorOther: 'Cannot continue automatically' }
    task.ask = vi.fn().mockResolvedValue({ response: 'yesButtonClicked' })
    await task.handleConsecutiveMistakes([])
    expect(task.ask).toHaveBeenCalledWith('mistake_limit_reached', 'Cannot continue automatically')
    expect(task.consecutiveMistakeCount).toBe(0)
  })

  it('does not skip a completed call when a partial preview finishes after the stream', async () => {
    task.resetStreamingState()
    const partial = { type: 'tool_use', name: 'attempt_completion', params: { result: 'Verified' }, partial: true }
    task.assistantMessageContent = [partial]
    let finishPreview!: () => void
    task.handleAttemptCompletionToolUse = vi.fn().mockResolvedValue(undefined)
    task.handleAttemptCompletionToolUse.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPreview = resolve
        })
    )
    const presentation = task.presentAssistantMessage()
    await vi.waitFor(() => expect(finishPreview).toBeTypeOf('function'))
    task.assistantMessageContent = [{ ...partial, partial: false }]
    task.didCompleteReadingStream = true
    task.presentAssistantMessageHasPendingUpdates = true
    finishPreview()
    await presentation
    await vi.waitFor(() => expect(task.handleAttemptCompletionToolUse).toHaveBeenCalledTimes(2))
    expect(task.handleAttemptCompletionToolUse.mock.calls[1][0].partial).toBe(false)
    await vi.waitFor(() => expect(task.userMessageContentReady).toBe(true))
  })
})

import { describe, expect, it } from 'vitest'
import { parseAssistantMessageWithProtocol } from './parse-tool-protocol'

const dsml = (name: string, params: Record<string, string>, bars = '｜｜') =>
  `<${bars}DSML${bars} calls>\n<${bars}DSML${bars} invoke name="${name}">\n` +
  Object.entries(params)
    .map(([key, value]) => `<${bars}DSML${bars} parameter name="${key}" string="true">${value}</${bars}DSML${bars} parameter>`)
    .join('\n') +
  `\n</${bars}DSML${bars} invoke>\n</${bars}DSML${bars} calls>`

describe('assistant tool protocol boundary', () => {
  it.each(['｜｜', '||'])('recognizes DSML %s tools independently of command or device', (bars) => {
    const params = { ip: 'test-device', command: 'ls /var/log 2>/dev/null && printf "&amp; <ok>"', requires_approval: 'false' }
    expect(parseAssistantMessageWithProtocol(dsml('execute_command', params, bars))).toEqual({
      content: [{ type: 'tool_use', name: 'execute_command', params, partial: false, format: 'dsml' }]
    })
  })

  it('does not expose or execute any fragmented envelope before it is complete', () => {
    const frame = dsml('read_file', { ip: 'test-device', path: '/var/log/app.log' })
    for (let i = 1; i < frame.length; i++) {
      const parsed = parseAssistantMessageWithProtocol(frame.slice(0, i))
      expect(
        parsed.content.some((block) => block.type === 'tool_use' && !block.partial),
        `split ${i}`
      ).toBe(false)
      expect(
        parsed.content.some((block) => block.type === 'text' && block.content.includes('DSML')),
        `split ${i}`
      ).toBe(false)
    }
    expect(parseAssistantMessageWithProtocol(frame).content[0]).toMatchObject({ name: 'read_file', partial: false })
  })

  it('preserves prose and mixed XML/DSML calls in source order', () => {
    const message = 'Checking now.\n' + dsml('todo_read', {}) + '\n<execute_command><command>id</command></execute_command>'
    const { content, protocolError } = parseAssistantMessageWithProtocol(message)
    expect(protocolError).toBeUndefined()
    expect(content).toMatchObject([
      { type: 'text', content: 'Checking now.', partial: false },
      { type: 'tool_use', name: 'todo_read' },
      { type: 'tool_use', name: 'execute_command', params: { command: 'id' } }
    ])
  })

  it('keeps XML/JSON in parameters opaque', () => {
    const params = { path: '/tmp/example', content: '<execute_command><command>not a call</command></execute_command>\n{"ok":true}' }
    expect(parseAssistantMessageWithProtocol(dsml('write_to_file', params)).content).toMatchObject([{ name: 'write_to_file', params }])
  })

  it.each([
    dsml('unknown_tool', {}),
    dsml('execute_command', { command: 'id', unknown: 'x' }),
    dsml('execute_command', { command: 'id' }).replace(
      '</｜｜DSML｜｜ invoke>',
      '<｜｜DSML｜｜ parameter name="command">whoami</｜｜DSML｜｜ parameter></｜｜DSML｜｜ invoke>'
    ),
    dsml('execute_command', { command: 'id' }).replace('</｜｜DSML｜｜ parameter>', ''),
    '<｜｜DSML｜｜ calls></｜｜DSML｜｜ calls>'
  ])('returns a repairable error for invalid envelopes without dispatching', (message) => {
    const parsed = parseAssistantMessageWithProtocol(message)
    expect(parsed.protocolError).toBeTruthy()
    expect(parsed.content.some((block) => block.type === 'tool_use')).toBe(false)
  })

  it('leaves quoted DSML examples and XML parameter content as data', () => {
    const frame = dsml('execute_command', { command: 'id' })
    for (const quoted of ['```xml\n' + frame + '\n```', '`<｜｜DSML｜｜ calls>`']) {
      expect(parseAssistantMessageWithProtocol(quoted)).toEqual({
        content: [{ type: 'text', content: quoted, partial: true }],
        protocolError: undefined
      })
    }
    const xml = `<write_to_file><content>${frame}</content></write_to_file>`
    expect(parseAssistantMessageWithProtocol(xml).content).toMatchObject([{ name: 'write_to_file', params: { content: frame } }])
  })
})

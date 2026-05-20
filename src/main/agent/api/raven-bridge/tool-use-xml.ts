//  Copyright (c) 2025-present, chaterm.ai  All rights reserved.
//  This source code is licensed under the GPL-3.0

/** Escape text embedded inside Chaterm tool-use XML param tags. */
function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Render tool parameter values as Chaterm XML blocks. */
export function formatToolParamsXml(input: Record<string, unknown>): string {
  return Object.entries(input)
    .map(([key, value]) => {
      const text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)
      return `<${key}>${escapeXml(text)}</${key}>`
    })
    .join('\n')
}

/** Build a complete Chaterm tool-use XML fragment from structured tool input. */
export function toolUseToXml(name: string, input: Record<string, unknown>): string {
  const params = formatToolParamsXml(input)
  return params.length > 0 ? `<${name}>\n${params}\n</${name}>` : `<${name}></${name}>`
}

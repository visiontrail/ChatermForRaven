import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import Dashboard from '../dashboard.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

vi.mock('@/config/shortcutActions', () => ({
  shortcutActions: [],
  shortcutHintKeys: {}
}))

vi.mock('@/services/shortcutService', () => ({
  shortcutService: {
    formatShortcut: vi.fn(),
    getShortcuts: vi.fn(() => ({}))
  }
}))

describe('dashboard', () => {
  it('displays the Raven terminal logo', () => {
    const wrapper = mount(Dashboard)
    const logo = wrapper.get('img.logo')

    expect(logo.attributes('alt')).toBe('Raven terminal')
    expect(logo.attributes('src')).toContain('raven-terminal.png')
  })
})

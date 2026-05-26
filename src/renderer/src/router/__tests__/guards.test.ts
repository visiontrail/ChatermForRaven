import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above imports, so any shared state used by mock factories
// must come from vi.hoisted().
const { loggerStub, embeddedMock } = vi.hoisted(() => ({
  loggerStub: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  embeddedMock: { isChatermEmbedded: vi.fn(() => false) }
}))

vi.stubGlobal('createRendererLogger', () => loggerStub)

vi.mock('@/utils/embedded', () => embeddedMock)

vi.mock('@/utils/permission', () => ({
  getUserInfo: vi.fn(() => null)
}))

vi.mock('@/services/dataSyncService', () => ({
  dataSyncService: { initialize: vi.fn(async () => undefined) }
}))

vi.mock('@/utils/logger', () => ({
  createRendererLogger: () => loggerStub
}))

import { beforeEach as routerBeforeEach } from '../guards'

interface FakeRoute {
  path: string
}

const makeNext = () => vi.fn()

const setEmbedded = (value: boolean) => {
  ;(embeddedMock.isChatermEmbedded as ReturnType<typeof vi.fn>).mockReturnValue(value)
}

beforeEach(() => {
  vi.clearAllMocks()
  loggerStub.error.mockClear()
  loggerStub.info.mockClear()
  loggerStub.warn.mockClear()
  loggerStub.debug.mockClear()
  localStorage.clear()
  delete (window as any).__ravenSessionReady
  ;(window as any).ravenUI = { notifyHostWarn: vi.fn() }
  ;(window as any).api = {
    initUserDatabase: vi.fn(async () => ({ success: true }))
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('beforeEach guard — embedded mode', () => {
  it('proceeds to / after Raven session payload is received', async () => {
    setEmbedded(true)
    ;(window as any).__ravenSessionReady = true
    const next = makeNext()

    await routerBeforeEach({ path: '/' } as FakeRoute, undefined as any, next)

    expect((window as any).api.initUserDatabase).toHaveBeenCalledWith({ uid: 999999999 })
    expect(next).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledWith()
    expect((window as any).ravenUI.notifyHostWarn).not.toHaveBeenCalled()
  })

  it('falls back to guest after 3s timeout and warns the host once', async () => {
    setEmbedded(true)
    vi.useFakeTimers()

    const next = makeNext()
    const pending = routerBeforeEach({ path: '/' } as FakeRoute, undefined as any, next)

    await vi.advanceTimersByTimeAsync(3100)
    await pending

    expect(loggerStub.error).toHaveBeenCalledWith('raven.session.handoff.timeout', expect.objectContaining({ path: '/' }))
    expect((window as any).ravenUI.notifyHostWarn).toHaveBeenCalledTimes(1)
    expect((window as any).ravenUI.notifyHostWarn).toHaveBeenCalledWith(expect.objectContaining({ code: 'raven.session.handoff.timeout' }))
    expect(localStorage.getItem('login-skipped')).toBe('true')
    expect(localStorage.getItem('ctm-token')).toBe('guest_token')
    expect(JSON.parse(localStorage.getItem('userInfo') || '{}').uid).toBe(999999999)
    expect(next).toHaveBeenCalledWith()
  })

  it('redirects /login to /', async () => {
    setEmbedded(true)
    ;(window as any).__ravenSessionReady = true
    const next = makeNext()

    await routerBeforeEach({ path: '/login' } as FakeRoute, undefined as any, next)

    expect(next).toHaveBeenCalledWith('/')
    expect((window as any).api.initUserDatabase).not.toHaveBeenCalled()
  })

  it('blocks navigation and warns the host when guest DB init fails', async () => {
    setEmbedded(true)
    ;(window as any).__ravenSessionReady = true
    ;(window as any).api.initUserDatabase.mockResolvedValueOnce({ success: false })
    const next = makeNext()

    await routerBeforeEach({ path: '/' } as FakeRoute, undefined as any, next)

    expect(loggerStub.error).toHaveBeenCalledWith('chaterm.guest.init.failed', expect.objectContaining({ path: '/' }))
    expect((window as any).ravenUI.notifyHostWarn).toHaveBeenCalledWith(expect.objectContaining({ code: 'chaterm.guest.init.failed' }))
    expect(next).toHaveBeenCalledWith(false)
  })
})

describe('beforeEach guard — non-embedded mode', () => {
  it('redirects to /login when no token is present', async () => {
    setEmbedded(false)
    const next = makeNext()

    await routerBeforeEach({ path: '/' } as FakeRoute, undefined as any, next)

    expect(next).toHaveBeenCalledWith('/login')
    expect((window as any).api.initUserDatabase).not.toHaveBeenCalled()
  })

  it('lets /login through without invoking initUserDatabase', async () => {
    setEmbedded(false)
    const next = makeNext()

    await routerBeforeEach({ path: '/login' } as FakeRoute, undefined as any, next)

    expect(next).toHaveBeenCalledWith()
    expect((window as any).api.initUserDatabase).not.toHaveBeenCalled()
  })
})

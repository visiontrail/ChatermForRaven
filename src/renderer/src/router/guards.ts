import { getUserInfo } from '@/utils/permission'
import { dataSyncService } from '@/services/dataSyncService'
import { isChatermEmbedded } from '@/utils/embedded'
import { createRendererLogger } from '@/utils/logger'

const logger = createRendererLogger('router')

const RAVEN_SESSION_TIMEOUT_MS = 3000
const GUEST_FALLBACK_PAYLOAD = {
  uid: 999999999,
  token: 'guest_token',
  isGuest: true,
  name: 'Guest'
} as const

const writeGuestSessionToLocalStorage = (payload: { uid: number; token: string; name: string; isGuest: boolean } = GUEST_FALLBACK_PAYLOAD) => {
  localStorage.setItem('login-skipped', 'true')
  localStorage.setItem('ctm-token', payload.token)
  localStorage.setItem(
    'userInfo',
    JSON.stringify({
      uid: payload.uid,
      username: payload.isGuest ? 'guest' : payload.name,
      name: payload.name,
      email: payload.isGuest ? 'guest@chaterm.ai' : '',
      token: payload.token
    })
  )
}

// In embedded mode the renderer subscribes to `window.ravenUI.onSession` from
// `main.ts`; that handler writes the guest payload into localStorage and sets
// `__ravenSessionReady`. The guard waits on that flag (with a 3s timeout) so
// the very first navigation only proceeds once identity is in place.
const waitForRavenSession = async (timeoutMs = RAVEN_SESSION_TIMEOUT_MS): Promise<boolean> => {
  if (window.__ravenSessionReady) return true
  return new Promise((resolve) => {
    const start = Date.now()
    const interval = window.setInterval(() => {
      if (window.__ravenSessionReady) {
        window.clearInterval(interval)
        resolve(true)
        return
      }
      if (Date.now() - start >= timeoutMs) {
        window.clearInterval(interval)
        resolve(false)
      }
    }, 50)
  })
}

const notifyHostSessionTimeout = () => {
  const ravenUI = (window as any).ravenUI
  try {
    ravenUI?.notifyHostWarn?.({
      code: 'raven.session.handoff.timeout',
      message: 'Terminal 初始化超时，已使用本地访客身份继续。如需排查请查看日志。'
    })
  } catch (err) {
    logger.error('notifyHostWarn failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

export const beforeEach = async (to, _from, next) => {
  const embedded = isChatermEmbedded()

  if (embedded) {
    const sessionReady = await waitForRavenSession()
    if (!sessionReady) {
      logger.error('raven.session.handoff.timeout', { path: to.path })
      writeGuestSessionToLocalStorage()
      window.__ravenSessionReady = true
      notifyHostSessionTimeout()
    }

    if (to.path === '/login') {
      next('/')
      return
    }

    try {
      const api = window.api as any
      const dbResult = await api.initUserDatabase({ uid: GUEST_FALLBACK_PAYLOAD.uid })
      if (!dbResult?.success) {
        logger.error('chaterm.guest.init.failed', { path: to.path })
        try {
          ;(window as any).ravenUI?.notifyHostWarn?.({
            code: 'chaterm.guest.init.failed',
            message: 'Terminal 初始化失败 — 查看日志'
          })
        } catch (warnErr) {
          logger.error('notifyHostWarn after guest init failure threw', {
            error: warnErr instanceof Error ? warnErr.message : String(warnErr)
          })
        }
        next(false)
        return
      }
      next()
    } catch (error) {
      logger.error('chaterm.guest.init.failed', { error: error instanceof Error ? error.message : String(error) })
      try {
        ;(window as any).ravenUI?.notifyHostWarn?.({
          code: 'chaterm.guest.init.failed',
          message: 'Terminal 初始化失败 — 查看日志'
        })
      } catch {
        // ignore secondary failures
      }
      next(false)
    }
    return
  }

  const token = localStorage.getItem('ctm-token')
  const isSkippedLogin = localStorage.getItem('login-skipped') === 'true'
  const isDev = import.meta.env.MODE === 'development'
  if (to.path === '/login') {
    if (isSkippedLogin) {
      localStorage.removeItem('login-skipped')
      localStorage.removeItem('ctm-token')
      localStorage.removeItem('jms-token')
      localStorage.removeItem('userInfo')
    }
    next()
    return
  }

  if (isSkippedLogin && token === 'guest_token') {
    try {
      const api = window.api as any
      const dbResult = await api.initUserDatabase({ uid: 999999999 })
      logger.info('Database initialization result', { success: dbResult.success })

      if (dbResult.success) {
        if (to.path === '/') {
          next()
        } else {
          next('/')
        }
      } else {
        logger.error('Database initialization failed, redirecting to login page')
        localStorage.removeItem('login-skipped')
        localStorage.removeItem('ctm-token')
        localStorage.removeItem('jms-token')
        localStorage.removeItem('userInfo')
        next('/login')
      }
    } catch (error) {
      logger.error('Database initialization failed', { error: error })
      localStorage.removeItem('login-skipped')
      localStorage.removeItem('ctm-token')
      localStorage.removeItem('jms-token')
      localStorage.removeItem('userInfo')
      next('/login')
    }
    return
  }

  if (token && !isSkippedLogin) {
    try {
      const userInfo = getUserInfo()
      if (userInfo && userInfo.uid) {
        const api = window.api as any
        const dbResult = await api.initUserDatabase({ uid: userInfo.uid })

        if (dbResult.success) {
          // After database initialization succeeds, asynchronously initialize data sync service (non-blocking UI display)
          dataSyncService.initialize().catch((error) => {
            logger.error('Data sync service initialization failed', { error: error })
          })
          next()
        } else {
          logger.error('Database initialization failed, redirecting to login page')
          next('/login')
        }
      } else {
        next('/login')
      }
    } catch (error) {
      logger.error('Processing failed', { error: error })

      const message = error instanceof Error ? error.message : String(error)

      // In the development environment, bypass the relevant errors (usually caused by hot updates)
      if (isDev && (message.includes('nextSibling') || message.includes('getUserInfo'))) {
        next()
        return
      }
      next('/login')
    }
  } else {
    next('/login')
  }
}

export const afterEach = () => {}

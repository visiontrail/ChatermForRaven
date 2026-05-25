import { getUserInfo } from '@/utils/permission'
import { dataSyncService } from '@/services/dataSyncService'
import { isChatermEmbedded } from '@/utils/embedded'

const logger = createRendererLogger('router')

// In Raven-embedded mode authentication is owned by the Raven host application,
// so the Chaterm login screen is never shown. We auto-provision the same guest
// session that the upstream "skip login" button uses.
const ensureEmbeddedGuestSession = () => {
  if (!isChatermEmbedded()) return
  if (localStorage.getItem('login-skipped') === 'true' && localStorage.getItem('ctm-token') === 'guest_token') {
    return
  }
  localStorage.setItem('login-skipped', 'true')
  localStorage.setItem('ctm-token', 'guest_token')
  localStorage.setItem(
    'userInfo',
    JSON.stringify({
      uid: 999999999,
      username: 'guest',
      name: 'Guest',
      email: 'guest@chaterm.ai',
      token: 'guest_token'
    })
  )
}

export const beforeEach = async (to, _from, next) => {
  ensureEmbeddedGuestSession()
  const embedded = isChatermEmbedded()

  // In embedded mode Chaterm's own main process is NOT running, so IPC channels
  // like `init-user-database` have no handler. Bypass all auth/db gating and
  // route every non-/login request straight through. Raven owns auth.
  if (embedded) {
    if (to.path === '/login') {
      next('/')
    } else {
      next()
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

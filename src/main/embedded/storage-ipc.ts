import { ipcMain } from 'electron'

import { versionPromptService } from '../version/versionPromptService'
import { loadUserTheme } from '../themeManager'
import { autoCompleteDatabaseService, ChatermDatabaseService, setCurrentUserId } from '../storage/database'
import { getCurrentUserId, getGuestUserId } from '../storage/db/connection'

const logger = createLogger('embedded/storage-ipc')

let autoCompleteService: autoCompleteDatabaseService | null = null
let chatermDbService: ChatermDatabaseService | null = null

const resolveUserId = (): number => getCurrentUserId() || getGuestUserId()
const getChatermDbService = async (): Promise<ChatermDatabaseService> => {
  if (!chatermDbService) {
    chatermDbService = await ChatermDatabaseService.getInstance(resolveUserId())
  }
  return chatermDbService
}

const getAutoCompleteService = async (): Promise<autoCompleteDatabaseService> => {
  if (!autoCompleteService) {
    autoCompleteService = await autoCompleteDatabaseService.getInstance(resolveUserId())
  }
  return autoCompleteService
}

const failedData = (error: unknown) => ({
  data: { message: 'failed', error: error instanceof Error ? error.message : String(error) }
})

/**
 * Storage IPC needed before Chaterm can render its embedded shell.
 *
 * These handlers are IPC-pure and do not depend on Chaterm's standalone
 * BrowserWindow, so they can safely run inside Raven's embedded bootstrap.
 */
export function registerEmbeddedStorageHandlers(): void {
  ipcMain.handle('main-window-show', async () => undefined)

  ipcMain.handle('init-user-database', async (_event, { uid }) => {
    try {
      const targetUserId = uid || getGuestUserId()
      const previousUserId = getCurrentUserId()

      setCurrentUserId(targetUserId)
      chatermDbService = await ChatermDatabaseService.getInstance(targetUserId)
      autoCompleteService = await autoCompleteDatabaseService.getInstance(targetUserId)

      const dbTheme = await loadUserTheme(chatermDbService)
      logger.info('embedded database initialized', {
        targetUserId,
        previousUserId,
        autoCompleteReady: !!autoCompleteService
      })

      return { success: true, theme: dbTheme }
    } catch (error) {
      logger.error('embedded database initialization failed', { error })
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' }
    }
  })

  ipcMain.handle('query-command', async (_event, data: { command: string; ip: string }) => {
    try {
      const db = await getAutoCompleteService()
      return db.queryCommand(data.command, data.ip)
    } catch (error) {
      logger.error('query-command error', { error })
      return null
    }
  })

  ipcMain.handle('insert-command', async (_event, data: { command: string; ip: string }) => {
    try {
      const db = await getAutoCompleteService()
      return db.insertCommand(data.command, data.ip)
    } catch (error) {
      logger.error('insert-command error', { error })
      return null
    }
  })

  ipcMain.handle('db:aliases:query', async (_event, params: { action: string; searchText?: string; alias?: string }) => {
    try {
      if (!['getAll', 'search', 'getByAlias'].includes(params.action)) {
        throw new Error('Invalid action type')
      }
      if (params.action === 'search' && !params.searchText) {
        throw new Error('search action requires searchText parameter')
      }
      if (params.action === 'getByAlias' && !params.alias) {
        throw new Error('getByAlias action requires alias parameter')
      }

      const db = await getChatermDbService()
      switch (params.action) {
        case 'getAll':
          return db.getAliases()
        case 'search':
          return db.searchAliases(params.searchText!)
        case 'getByAlias': {
          const result = db.getAliasByName(params.alias!)
          return result ? [result] : []
        }
        default:
          throw new Error('Invalid action')
      }
    } catch (error) {
      logger.error('db:aliases:query error', { error })
      throw error
    }
  })

  ipcMain.handle('db:aliases:mutate', async (_event, params: { action: string; data?: any; alias?: string }) => {
    try {
      if (!['save', 'delete'].includes(params.action)) {
        throw new Error('Invalid action type')
      }
      if (params.action === 'save' && !params.data) {
        throw new Error('save action requires data parameter')
      }
      if (params.action === 'delete' && !params.alias) {
        throw new Error('delete action requires alias parameter')
      }

      const db = await getChatermDbService()
      switch (params.action) {
        case 'save':
          return db.saveAlias(params.data)
        case 'delete':
          return db.deleteAlias(params.alias!)
        default:
          throw new Error('Invalid action')
      }
    } catch (error) {
      logger.error('db:aliases:mutate error', { error })
      throw error
    }
  })

  ipcMain.handle('asset-route-local-get', async (_event, data: { searchType: string; params?: any[] }) => {
    try {
      const db = await getChatermDbService()
      return await db.getLocalAssetRoute(data.searchType, data.params || [])
    } catch (error) {
      logger.error('asset-route-local-get error', { error })
      return null
    }
  })

  ipcMain.handle('record-connection', async (_event, data) => {
    try {
      const db = await getChatermDbService()
      db.recordConnection(data)
    } catch (error) {
      logger.error('record-connection error', { error })
    }
  })

  ipcMain.handle('asset-route-local-update', async (_event, data: { uuid: string; label: string }) => {
    try {
      const db = await getChatermDbService()
      return db.updateLocalAssetLabel(data.uuid, data.label)
    } catch (error) {
      logger.error('asset-route-local-update error', { error })
      return null
    }
  })

  ipcMain.handle('asset-route-local-favorite', async (_event, data: { uuid: string; status: number }) => {
    try {
      const db = await getChatermDbService()
      return db.updateLocalAsseFavorite(data.uuid, data.status)
    } catch (error) {
      logger.error('asset-route-local-favorite error', { error })
      return null
    }
  })

  ipcMain.handle('key-chain-local-get', async () => {
    try {
      const db = await getChatermDbService()
      return db.getKeyChainSelect()
    } catch (error) {
      logger.error('key-chain-local-get error', { error })
      return null
    }
  })

  ipcMain.handle('asset-group-local-get', async () => {
    try {
      const db = await getChatermDbService()
      return db.getAssetGroup()
    } catch (error) {
      logger.error('asset-group-local-get error', { error })
      return null
    }
  })

  ipcMain.handle('asset-delete', async (_event, data: { uuid: string }) => {
    try {
      const db = await getChatermDbService()
      return db.deleteAsset(data.uuid)
    } catch (error) {
      logger.error('asset-delete error', { error })
      return null
    }
  })

  ipcMain.handle('asset-create', async (_event, data: { form: any }) => {
    try {
      const db = await getChatermDbService()
      return db.createAsset(data.form)
    } catch (error) {
      logger.error('asset-create error', { error })
      return null
    }
  })

  ipcMain.handle('asset-create-or-update', async (_event, data: { form: any }) => {
    try {
      const db = await getChatermDbService()
      return db.createOrUpdateAsset(data.form)
    } catch (error) {
      logger.error('asset-create-or-update error', { error })
      return null
    }
  })

  ipcMain.handle('asset-update', async (_event, data: { form: any }) => {
    try {
      const db = await getChatermDbService()
      return db.updateAsset(data.form)
    } catch (error) {
      logger.error('asset-update error', { error })
      return null
    }
  })

  ipcMain.handle('key-chain-local-get-list', async () => {
    try {
      const db = await getChatermDbService()
      return db.getKeyChainList()
    } catch (error) {
      logger.error('key-chain-local-get-list error', { error })
      return null
    }
  })

  ipcMain.handle('key-chain-local-create', async (_event, data: { form: any }) => {
    try {
      const db = await getChatermDbService()
      return db.createKeyChain(data.form)
    } catch (error) {
      logger.error('key-chain-local-create error', { error })
      return null
    }
  })

  ipcMain.handle('key-chain-local-delete', async (_event, data: { id: number }) => {
    try {
      const db = await getChatermDbService()
      return db.deleteKeyChain(data.id)
    } catch (error) {
      logger.error('key-chain-local-delete error', { error })
      return null
    }
  })

  ipcMain.handle('key-chain-local-get-info', async (_event, data: { id: number }) => {
    try {
      const db = await getChatermDbService()
      return db.getKeyChainInfo(data.id)
    } catch (error) {
      logger.error('key-chain-local-get-info error', { error })
      return null
    }
  })

  ipcMain.handle('key-chain-local-update', async (_event, data: { form: any }) => {
    try {
      const db = await getChatermDbService()
      return db.updateKeyChain(data.form)
    } catch (error) {
      logger.error('key-chain-local-update error', { error })
      return null
    }
  })

  ipcMain.handle('chaterm-connect-asset-info', async (_event, data: { uuid: string; organizationUuid?: string; ip?: string }) => {
    try {
      const db = await getChatermDbService()
      const fallback = data.organizationUuid || data.ip ? { organizationUuid: data.organizationUuid, ip: data.ip } : undefined
      return db.connectAssetInfo(data.uuid, fallback)
    } catch (error) {
      logger.error('chaterm-connect-asset-info error', { error })
      return null
    }
  })

  ipcMain.handle('get-user-hosts', async (_event, data: { search?: string; limit?: number }) => {
    try {
      const db = await getChatermDbService()
      return db.getUserHosts(data?.search || '', data?.limit || 50)
    } catch (error) {
      logger.error('get-user-hosts error', { error })
      return null
    }
  })

  ipcMain.handle('user-snippet-operation', async (_event, data: { operation: any; params?: any }) => {
    try {
      const db = await getChatermDbService()
      return db.userSnippetOperation(data.operation, data.params)
    } catch (error) {
      logger.error('user-snippet-operation error', { error })
      return {
        code: 500,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  })

  ipcMain.handle('create-custom-folder', async (_event, data: { name: string; description?: string }) => {
    try {
      if (!data?.name) {
        return { data: { message: 'failed', error: 'Folder name cannot be empty' } }
      }
      const db = await getChatermDbService()
      return db.createCustomFolder(data.name, data.description)
    } catch (error) {
      logger.error('create-custom-folder error', { error })
      return failedData(error)
    }
  })

  ipcMain.handle('get-custom-folders', async () => {
    try {
      const db = await getChatermDbService()
      return db.getCustomFolders()
    } catch (error) {
      logger.error('get-custom-folders error', { error })
      return { data: { message: 'failed', error: error instanceof Error ? error.message : String(error) } }
    }
  })

  ipcMain.handle('update-custom-folder', async (_event, data: { folderUuid: string; name: string; description?: string }) => {
    try {
      if (!data?.folderUuid || !data?.name) {
        return { data: { message: 'failed', error: 'Folder UUID and name cannot be empty' } }
      }
      const db = await getChatermDbService()
      return db.updateCustomFolder(data.folderUuid, data.name, data.description)
    } catch (error) {
      logger.error('update-custom-folder error', { error })
      return failedData(error)
    }
  })

  ipcMain.handle('delete-custom-folder', async (_event, data: { folderUuid: string }) => {
    try {
      if (!data?.folderUuid) {
        return { data: { message: 'failed', error: 'Folder UUID cannot be empty' } }
      }
      const db = await getChatermDbService()
      return db.deleteCustomFolder(data.folderUuid)
    } catch (error) {
      logger.error('delete-custom-folder error', { error })
      return failedData(error)
    }
  })

  ipcMain.handle('move-asset-to-folder', async (_event, data: { folderUuid: string; organizationUuid: string; assetHost: string }) => {
    try {
      if (!data?.folderUuid || !data?.organizationUuid || !data?.assetHost) {
        return { data: { message: 'failed', error: 'Incomplete parameters' } }
      }
      const db = await getChatermDbService()
      return db.moveAssetToFolder(data.folderUuid, data.organizationUuid, data.assetHost)
    } catch (error) {
      logger.error('move-asset-to-folder error', { error })
      return failedData(error)
    }
  })

  ipcMain.handle('remove-asset-from-folder', async (_event, data: { folderUuid: string; organizationUuid: string; assetHost: string }) => {
    try {
      if (!data?.folderUuid || !data?.organizationUuid || !data?.assetHost) {
        return { data: { message: 'failed', error: 'Incomplete parameters' } }
      }
      const db = await getChatermDbService()
      return db.removeAssetFromFolder(data.folderUuid, data.organizationUuid, data.assetHost)
    } catch (error) {
      logger.error('remove-asset-from-folder error', { error })
      return failedData(error)
    }
  })

  ipcMain.handle('get-assets-in-folder', async (_event, data: { folderUuid: string }) => {
    try {
      if (!data?.folderUuid) {
        return { data: { message: 'failed', error: 'Folder UUID cannot be empty' } }
      }
      const db = await getChatermDbService()
      return db.getAssetsInFolder(data.folderUuid)
    } catch (error) {
      logger.error('get-assets-in-folder error', { error })
      return failedData(error)
    }
  })

  ipcMain.handle('db:kv:get', async (_event, params: { key?: string }) => {
    try {
      const db = await ChatermDatabaseService.getInstance(resolveUserId())

      if (!params?.key) {
        return db.getAllKeys()
      }

      const row = db.getKeyValue(params.key)
      if (row && row.value) {
        const { deserializeStoredKvValue } = await import('../storage/db/kv-serialization')
        const deserialized = await deserializeStoredKvValue(row.value)
        return { ...row, value: JSON.stringify(deserialized.value) }
      }
      return row
    } catch (error) {
      logger.error('db:kv:get error', { error })
      throw error
    }
  })

  ipcMain.handle('db:kv:mutate', async (_event, params: { action: string; key: string; value?: string }) => {
    try {
      if (!['set', 'delete'].includes(params.action)) {
        throw new Error('Invalid action type')
      }
      if (!params.key) {
        throw new Error('key parameter is required')
      }
      if (params.action === 'set' && params.value === undefined) {
        throw new Error('set action requires value parameter')
      }

      const db = await ChatermDatabaseService.getInstance(resolveUserId())

      if (params.action === 'delete') {
        return db.deleteKeyValue(params.key)
      }

      const valueObj = JSON.parse(params.value!)
      const { safeStringify } = await import('../storage/db/json-serializer')
      const result = await safeStringify(valueObj)
      if (!result.success) {
        throw new Error(`Failed to serialize value: ${result.error}`)
      }

      return db.setKeyValue({
        key: params.key,
        value: result.data!,
        updated_at: Date.now()
      })
    } catch (error) {
      logger.error('db:kv:mutate error', { error })
      throw error
    }
  })

  ipcMain.handle('db:kv:transaction', async (_event, ops: Array<{ action: 'set' | 'delete'; key: string; value?: string }>) => {
    try {
      const db = await ChatermDatabaseService.getInstance(resolveUserId())
      const { serializeKvTransactionOps } = await import('../storage/db/kv-serialization')
      await db.kvTransaction(await serializeKvTransactionOps(ops))
    } catch (error) {
      logger.error('db:kv:transaction error', { error })
      throw error
    }
  })

  ipcMain.handle('version:operation', async (_event, operation: string, payload?: any) => {
    try {
      switch (operation) {
        case 'getPrompt':
          return await versionPromptService.getVersionPrompt()
        case 'dismissPrompt':
          await versionPromptService.dismissPrompt()
          return
        case 'getReleaseNotes':
          return await versionPromptService.getReleaseNotes(payload?.version)
        default:
          throw new Error(`Unknown version operation: ${operation}`)
      }
    } catch (error) {
      logger.error(`version:operation [${operation}] error`, { error })
      throw error
    }
  })
}

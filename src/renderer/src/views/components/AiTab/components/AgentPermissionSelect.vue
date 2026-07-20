<template>
  <a-tooltip
    :title="currentOption.description"
    placement="top"
    :mouse-enter-delay="0.35"
    :open="permissionTooltipVisible && !permissionSelectOpen"
    @open-change="permissionTooltipVisible = $event"
  >
    <div
      class="agent-permission-control"
      :class="`permission-${permissionMode}`"
    >
      <SafetyCertificateOutlined class="permission-shield" />
      <a-select
        v-model:value="permissionMode"
        v-model:open="permissionSelectOpen"
        size="small"
        class="agent-permission-select"
        :options="permissionOptions"
        :dropdown-match-select-width="false"
        popup-class-name="agent-permission-dropdown"
        data-testid="agent-permission-select"
        :aria-label="t('ai.agentPermissionLabel')"
        @change="handlePermissionChange"
        @dropdown-visible-change="permissionSelectOpen = $event"
        @keydown.esc.stop
      >
        <template #option="option">
          <div class="permission-option">
            <span
              class="permission-option-dot"
              :class="`permission-option-dot-${option.value}`"
            ></span>
            <span class="permission-option-copy">
              <span class="permission-option-label">{{ option.label }}</span>
              <span class="permission-option-description">{{ option.description }}</span>
            </span>
          </div>
        </template>
      </a-select>
    </div>
  </a-tooltip>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { notification } from 'ant-design-vue'
import { SafetyCertificateOutlined } from '@ant-design/icons-vue'

import { DEFAULT_AUTO_APPROVAL_SETTINGS, type AutoApprovalSettings } from '@renderer/agent/storage/shared'
import { getGlobalState, updateGlobalState } from '@renderer/agent/storage/state'
import { applyAgentPermissionMode, getAgentPermissionMode, type AgentPermissionMode } from '@shared/AgentPermissionMode'

const logger = createRendererLogger('ai.agentPermission')
const PERMISSION_MODE_CHANGED_EVENT = 'chaterm:agent-permission-mode-changed'

const { t } = useI18n()
const permissionMode = ref<AgentPermissionMode>('ask')
const appliedPermissionMode = ref<AgentPermissionMode>('ask')
const permissionSelectOpen = ref(false)
const permissionTooltipVisible = ref(false)

const permissionOptions = computed(() => [
  {
    value: 'ask' as const,
    label: t('ai.agentPermissionAsk'),
    description: t('ai.agentPermissionAskDescription')
  },
  {
    value: 'read-only' as const,
    label: t('ai.agentPermissionReadOnly'),
    description: t('ai.agentPermissionReadOnlyDescription')
  },
  {
    value: 'full' as const,
    label: t('ai.agentPermissionFull'),
    description: t('ai.agentPermissionFullDescription')
  }
])

const currentOption = computed(() => permissionOptions.value.find((option) => option.value === permissionMode.value) ?? permissionOptions.value[0])

const normalizeSettings = (value: unknown): AutoApprovalSettings => {
  const stored = value && typeof value === 'object' ? (value as Partial<AutoApprovalSettings>) : {}
  return {
    ...DEFAULT_AUTO_APPROVAL_SETTINGS,
    ...stored,
    actions: {
      ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
      ...(stored.actions || {})
    },
    favorites: [...(stored.favorites || DEFAULT_AUTO_APPROVAL_SETTINGS.favorites)]
  }
}

const syncSettingsToAgent = async (settings: AutoApprovalSettings): Promise<void> => {
  if (window.api?.setAgentAutoApprovalSettings) {
    await window.api.setAgentAutoApprovalSettings(settings)
  }
}

const handlePermissionChange = async (mode: AgentPermissionMode): Promise<void> => {
  const previousMode = appliedPermissionMode.value
  permissionSelectOpen.value = false
  permissionTooltipVisible.value = false
  try {
    const currentSettings = normalizeSettings(await getGlobalState('autoApprovalSettings'))
    const settings = applyAgentPermissionMode(currentSettings, mode) as AutoApprovalSettings

    await syncSettingsToAgent(settings)
    await updateGlobalState('autoApprovalSettings', settings)
    appliedPermissionMode.value = mode
    window.dispatchEvent(new CustomEvent(PERMISSION_MODE_CHANGED_EVENT, { detail: mode }))
  } catch (error) {
    permissionMode.value = previousMode
    logger.error('Failed to update Agent permission mode', { error })
    notification.error({
      message: t('ai.agentPermissionUpdateFailed'),
      description: t('ai.agentPermissionUpdateFailedDescription')
    })
  }
}

const handleSharedModeChange = (event: Event): void => {
  const mode = (event as CustomEvent<AgentPermissionMode>).detail
  if (mode === 'ask' || mode === 'read-only' || mode === 'full') {
    permissionMode.value = mode
    appliedPermissionMode.value = mode
  }
}

onMounted(async () => {
  window.addEventListener(PERMISSION_MODE_CHANGED_EVENT, handleSharedModeChange)
  try {
    const settings = normalizeSettings(await getGlobalState('autoApprovalSettings'))
    permissionMode.value = getAgentPermissionMode(settings)
    appliedPermissionMode.value = permissionMode.value
    await syncSettingsToAgent(settings)
  } catch (error) {
    logger.warn('Failed to initialize Agent permission mode', { error })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener(PERMISSION_MODE_CHANGED_EVENT, handleSharedModeChange)
})
</script>

<style scoped lang="less">
.agent-permission-control {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 1 148px;
  min-width: 104px;
  max-width: 148px;
  border-radius: 5px;
  transition:
    background-color 0.18s ease,
    box-shadow 0.18s ease;

  &.permission-ask {
    --permission-accent: #d48806;
    --permission-tint: rgba(212, 136, 6, 0.1);
  }

  &.permission-read-only {
    --permission-accent: #1677ff;
    --permission-tint: rgba(22, 119, 255, 0.1);
  }

  &.permission-full {
    --permission-accent: #d4380d;
    --permission-tint: rgba(212, 56, 13, 0.11);
  }

  &:hover {
    background: var(--permission-tint);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--permission-accent) 35%, transparent);
  }
}

.permission-shield {
  position: absolute;
  left: 6px;
  z-index: 1;
  color: var(--permission-accent);
  font-size: 12px;
  pointer-events: none;
}

.agent-permission-select {
  width: 100%;

  :deep(.ant-select-selector) {
    padding-left: 23px !important;
  }

  :deep(.ant-select-selection-item) {
    color: var(--permission-accent) !important;
    font-weight: 560;
  }
}
</style>

<style lang="less">
.agent-permission-dropdown {
  min-width: 270px !important;

  .ant-select-item {
    padding: 7px 10px !important;
  }

  .permission-option {
    display: flex;
    align-items: flex-start;
    gap: 9px;
  }

  .permission-option-dot {
    width: 7px;
    height: 7px;
    margin-top: 5px;
    border-radius: 50%;
    flex: 0 0 auto;
    box-shadow: 0 0 0 3px rgba(128, 128, 128, 0.1);
  }

  .permission-option-dot-ask {
    background: #d48806;
  }

  .permission-option-dot-read-only {
    background: #1677ff;
  }

  .permission-option-dot-full {
    background: #d4380d;
  }

  .permission-option-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1px;
  }

  .permission-option-label {
    color: var(--text-color);
    font-size: 12px;
    font-weight: 600;
    line-height: 18px;
  }

  .permission-option-description {
    color: var(--text-color-secondary);
    font-size: 10px;
    line-height: 15px;
    white-space: normal;
  }
}
</style>

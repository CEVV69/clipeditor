<script setup lang="ts">
export interface ToolDef {
  id: string
  label: string
  icon: 'cut' | 'speed' | 'logo' | 'crop' | 'rotate' | 'frame'
}

defineProps<{
  tools: ToolDef[]
  modelValue: string
  disabled: boolean
}>()

defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()
</script>

<template>
  <nav class="tool-nav glass" :class="{ disabled }">
    <button
      v-for="tool in tools"
      :key="tool.id"
      type="button"
      class="tool-btn"
      :class="{ active: modelValue === tool.id }"
      :disabled="disabled"
      @click="$emit('update:modelValue', tool.id)"
    >
      <svg v-if="tool.icon === 'cut'" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="6" cy="6" r="2.2" />
        <circle cx="6" cy="18" r="2.2" />
        <line x1="8" y1="7.4" x2="20" y2="19" />
        <line x1="8" y1="16.6" x2="20" y2="5" />
      </svg>
      <svg v-else-if="tool.icon === 'speed'" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3.5 13a8.5 8.5 0 0 1 17 0" />
        <line x1="12" y1="13" x2="15.5" y2="9.3" />
        <circle cx="12" cy="13" r="1.2" fill="currentColor" stroke="none" />
      </svg>
      <svg v-else-if="tool.icon === 'logo'" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4.5" y="6.5" width="15" height="11" rx="2" />
        <line x1="4.5" y1="6.5" x2="19.5" y2="17.5" />
      </svg>
      <svg v-else-if="tool.icon === 'crop'" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 2v15a2 2 0 0 0 2 2h13" />
        <path d="M2 7h15a2 2 0 0 1 2 2v13" />
      </svg>
      <svg v-else-if="tool.icon === 'rotate'" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3.5 12a8.5 8.5 0 1 1 2.8 6.3" />
        <path d="M3 17v-4.5h4.5" />
      </svg>
      <svg v-else class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="12" cy="12" r="3.5" />
      </svg>
      <span class="label">{{ tool.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.tool-nav {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 14px;
  margin: 0 auto;
  max-width: 100%;
  overflow-x: auto;
  /* Oculta la barra de scroll (igual en todos los navegadores que
     importan acá) — se desliza igual, solo que sin la barra fea. */
  scrollbar-width: none;
}
.tool-nav::-webkit-scrollbar {
  display: none;
}
.tool-nav.disabled {
  opacity: 0.4;
}
.tool-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 9px;
  background: transparent;
  color: var(--text-dim);
  border: none;
  border-radius: 11px;
  font-size: 0.8rem;
  letter-spacing: -0.01em;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.tool-btn:hover:not(:disabled):not(.active) {
  color: var(--text);
}
.tool-btn.active {
  background: var(--glass-strong);
  color: var(--text);
}
.icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

@media (max-width: 560px) {
  .tool-btn .label {
    display: none;
  }
  .tool-btn {
    padding: 9px 12px;
  }
  .icon {
    width: 17px;
    height: 17px;
  }
}
</style>

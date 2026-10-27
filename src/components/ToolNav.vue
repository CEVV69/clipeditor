<script setup lang="ts">
export interface ToolDef {
  id: string
  label: string
  icon: 'cut' | 'speed' | 'logo'
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
  <nav class="tool-nav" :class="{ disabled }">
    <button
      v-for="tool in tools"
      :key="tool.id"
      type="button"
      class="tool-btn"
      :class="{ active: modelValue === tool.id }"
      :disabled="disabled"
      @click="$emit('update:modelValue', tool.id)"
    >
      <svg v-if="tool.icon === 'cut'" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="6" cy="6" r="2.4" />
        <circle cx="6" cy="18" r="2.4" />
        <line x1="8.1" y1="7.5" x2="20" y2="19" />
        <line x1="8.1" y1="16.5" x2="20" y2="5" />
      </svg>
      <svg v-else-if="tool.icon === 'speed'" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 13a9 9 0 0 1 18 0" />
        <line x1="12" y1="13" x2="16" y2="9" />
        <circle cx="12" cy="13" r="1.3" fill="currentColor" stroke="none" />
      </svg>
      <svg v-else class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <line x1="4" y1="6" x2="20" y2="18" />
      </svg>
      <span class="label">{{ tool.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.tool-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 0 0 180px;
}
.tool-nav.disabled {
  opacity: 0.45;
}
.tool-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: transparent;
  color: var(--text-dim);
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 0.9rem;
  text-align: left;
}
.tool-btn:hover:not(:disabled) {
  background: var(--panel);
}
.tool-btn.active {
  background: var(--panel);
  border-color: var(--accent);
  color: var(--text);
}
.icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

@media (max-width: 720px) {
  .tool-nav {
    flex-direction: row;
    flex: none;
    width: 100%;
    overflow-x: auto;
    gap: 6px;
    padding-bottom: 2px;
  }
  .tool-btn {
    flex: 1;
    flex-direction: column;
    gap: 4px;
    text-align: center;
    padding: 10px 6px;
    font-size: 0.78rem;
  }
}
</style>

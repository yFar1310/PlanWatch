import { onMounted, onUnmounted, ref, watch } from 'vue';

type Theme = 'system' | 'light' | 'dark';
const key = 'planwatch:theme';
function valid(value: unknown): Theme { return value === 'light' || value === 'dark' ? value : 'system'; }

export function useTheme() {
  let initial: Theme = 'system';
  try { initial = valid(localStorage.getItem(key)); } catch { /* System theme works without storage. */ }
  const preference = ref(initial);
  const isDark = ref(false);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const dark = preference.value === 'dark' || (preference.value === 'system' && media.matches);
    isDark.value = dark;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#12141c' : '#f8f9fc');
  };
  watch(preference, () => {
    try { localStorage.setItem(key, preference.value); } catch { /* Keep the setting for this session. */ }
    apply();
  }, { immediate: true });
  const sync = (event: StorageEvent) => { if (event.key === key || event.key === null) preference.value = valid(event.newValue); };
  onMounted(() => { media.addEventListener('change', apply); window.addEventListener('storage', sync); });
  onUnmounted(() => { media.removeEventListener('change', apply); window.removeEventListener('storage', sync); });
  const toggle = () => { preference.value = isDark.value ? 'light' : 'dark'; };
  return { isDark, toggle };
}

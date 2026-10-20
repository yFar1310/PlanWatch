import { ref } from 'vue';
export const pendingInvitation = ref('');
const key = 'planwatch:pending-invitation';
export function captureInvitation() {
  const match = location.hash.match(/^#invite=([A-Za-z0-9_-]{43})$/);
  try {
    if (match) sessionStorage.setItem(key, match[1]!);
    pendingInvitation.value = sessionStorage.getItem(key) ?? '';
  } catch { if (match) pendingInvitation.value = match[1]!; }
  if (match) history.replaceState(null, '', location.pathname + location.search);
}
export function clearInvitation() {
  pendingInvitation.value = '';
  try { sessionStorage.removeItem(key); } catch { /* Memory remains usable. */ }
}
export function invitationCode(value: string) {
  const text = value.trim();
  if (/^[A-Za-z0-9_-]{43}$/.test(text)) return text;
  try { return new URL(text).hash.match(/^#invite=([A-Za-z0-9_-]{43})$/)?.[1] ?? ''; } catch { return ''; }
}

import { computed, onMounted, onUnmounted, ref } from 'vue';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export function usePwa() {
  const installed = ref(window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const prompt = ref<InstallEvent | null>(null);
  const help = ref('');
  const update = ref<ServiceWorker | null>(null);
  const registrationError = ref(false);
  let registration: ServiceWorkerRegistration | undefined;
  let reloading = false;
  const capturePrompt = (event: Event) => { event.preventDefault(); prompt.value = event as InstallEvent; };
  const onInstalled = () => { installed.value = true; prompt.value = null; help.value = ''; };
  const onController = () => { if (reloading) window.location.reload(); };
  const onUpdate = () => {
    const worker = registration?.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) update.value = registration?.waiting ?? null;
    });
  };
  async function install() {
    if (prompt.value) {
      const event = prompt.value;
      prompt.value = null;
      try { await event.prompt(); await event.userChoice; } catch { help.value = 'Use your browser menu to install PlanWatch or add it to your home screen.'; }
    } else {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      help.value = ios ? 'On iPhone or iPad: open this page in Safari, tap Share, then Add to Home Screen.' : 'Open your browser menu and choose Install app, Add to Home Screen, or Add to Dock if available.';
    }
  }
  function applyUpdate() {
    if (!update.value) return;
    reloading = true;
    update.value.postMessage('ACTIVATE_UPDATE');
  }
  onMounted(async () => {
    window.addEventListener('beforeinstallprompt', capturePrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    try {
      navigator.serviceWorker.addEventListener('controllerchange', onController);
      registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      if (registration.waiting) update.value = registration.waiting;
      registration.addEventListener('updatefound', onUpdate);
    } catch { registrationError.value = true; }
  });
  onUnmounted(() => {
    window.removeEventListener('beforeinstallprompt', capturePrompt);
    window.removeEventListener('appinstalled', onInstalled);
    if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('controllerchange', onController);
    registration?.removeEventListener('updatefound', onUpdate);
  });
  return { canInstall: computed(() => window.isSecureContext && !installed.value), help, install, update, applyUpdate, registrationError };
}

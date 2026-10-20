import { createApp } from 'vue';
import { clerkPlugin } from '@clerk/vue';
import Root from './Root.vue';
import { clerkEnabled, clerkPublishableKey } from './auth-config';
import { setApiBaseUrl } from './api';
import './style.css';

import { captureInvitation } from './invitations';

captureInvitation();
// Opening an invitation in an already-open app can change only the fragment.
window.addEventListener('hashchange', captureInvitation);
const app = createApp(Root);
setApiBaseUrl(import.meta.env.VITE_API_BASE_URL ?? '/api');
if (clerkEnabled) app.use(clerkPlugin, { publishableKey: clerkPublishableKey });
app.mount('#app');

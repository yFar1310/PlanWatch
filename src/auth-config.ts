export const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? '';
export const clerkEnabled = /^pk_(test|live)_[A-Za-z0-9+/=_-]+$/.test(clerkPublishableKey);
export const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

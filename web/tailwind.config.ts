// tailwind.config.ts
import type { Config } from 'tailwindcss';
import forms from '@tailwindcss/forms';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#4f46e5', foreground: '#ffffff' },
      },
      boxShadow: { card: '0 2px 10px rgba(0,0,0,0.06)' },
      borderRadius: { xl: '0.75rem', '2xl': '1rem' },
    },
  },
  plugins: [forms],
} satisfies Config;

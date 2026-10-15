/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  safelist: [
    'bg-emerald-500/10', 'bg-amber-500/10', 'bg-teal-500/10', 'bg-rose-500/10', 'bg-sky-500/10',
    'bg-violet-500/10', 'bg-gray-500/10', 'bg-brand-600/10',
    'text-brand-600', 'text-amber-600', 'text-teal-600', 'text-rose-600', 'text-sky-600', 'text-violet-600', 'text-ink-mute',
  ],
  theme: {
    extend: {
      colors: {
        // White + green brand palette
        brand: {
          50: '#F0FAF4', 100: '#DDF3E8', 200: '#BDE6D1', 300: '#8FD3B3', 400: '#3FB68A',
          500: '#12A06F', 600: '#0F8A5F', 700: '#0B7A54', 800: '#0A6B47', 900: '#0A4F36',
        },
        ink: { DEFAULT: '#0F1F17', soft: '#2B3B32', mute: '#5F7367', faint: '#8A9C91' },
        paper: {
          DEFAULT: '#FFFFFF', tint: '#F6FAF7', mist: '#EEF4F0', line: '#E3ECE6', line2: '#D3E1D8', deep: '#E4EEE8',
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,31,23,.04), 0 8px 24px -12px rgba(15,31,23,.14)',
        lift: '0 2px 4px rgba(15,31,23,.05), 0 16px 32px -12px rgba(15,138,95,.35)',
      },
      animation: {
        'float': 'float 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

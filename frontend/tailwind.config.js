/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          200: 'var(--brand-200)',
          300: 'var(--brand-300)',
          400: 'var(--brand-400)',
          500: 'var(--brand-500)',
          600: 'var(--brand-600)',
          700: 'var(--brand-700)',
          800: 'var(--brand-800)',
          900: 'var(--brand-900)',
          950: 'var(--brand-950)',
        },
        // All gray shades are theme variables — components don't change,
        // only the variable values flip between dark and light.
        gray: {
          100:  'var(--gray-100)',
          200:  'var(--gray-200)',
          300:  'var(--gray-300)',
          400:  'var(--gray-400)',
          500:  'var(--gray-500)',
          600:  'var(--gray-600)',
          700:  'var(--gray-700)',
          800:  'var(--gray-800)',
          900:  'var(--gray-900)',
          950:  'var(--gray-950)',
        },
      },
    },
  },
  plugins: [],
}

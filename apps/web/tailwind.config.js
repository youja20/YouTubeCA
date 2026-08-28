/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        positive: { DEFAULT: '#0d9488', soft: '#ccfbf1' },
        negative: { DEFAULT: '#dc2626', soft: '#fee2e2' },
        neutralTone: { DEFAULT: '#64748b', soft: '#e2e8f0' },
      },
      fontFamily: {
        sans: ['Pretendard', 'Apple SD Gothic Neo', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

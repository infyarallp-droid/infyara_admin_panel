/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Sampled from the Moksha Wellness logo (deep green lotus, red bindu).
        brand: {
          DEFAULT: '#17643c',
          fg: '#0f4a2c',
          soft: '#e7f1eb',
        },
        bindu: '#d81e2c',
      },
      borderRadius: {
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Sampled from the Moksha Wellness logo (deep green lotus #093a18, maroon bindu #82171c).
        brand: {
          DEFAULT: '#0e4a22',
          fg: '#093a18',
          soft: '#e6efe8',
        },
        bindu: '#82171c',
      },
      borderRadius: {
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
};

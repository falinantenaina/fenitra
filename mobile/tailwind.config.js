/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#208AEF',
          dark: '#1769B0',
        },
        success: '#16A34A',
        danger: '#DC2626',
        warning: '#D97706',
      },
    },
  },
  plugins: [],
};

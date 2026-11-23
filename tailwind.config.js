/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        maroon: { 50: "#fdf2f4", 100: "#fbe4e8", 600: "#9f1239", 700: "#881337", 800: "#6b0f2a", 900: "#4c0519" },
        gold: { 100: "#fef3c7", 300: "#fcd34d", 500: "#d4a017", 600: "#b8860b" },
      },
      fontFamily: {
        sans: ["Mukta", "Noto Sans Devanagari", "system-ui", "sans-serif"],
        display: ["Yatra One", "Mukta", "serif"],
      },
    },
  },
  plugins: [],
};

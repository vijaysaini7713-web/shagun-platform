/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        maroon: { 50: "#fdf2f4", 100: "#fbe4e8", 600: "#9f1239", 700: "#881337", 800: "#6b0f2a", 900: "#4c0519" },
        gold: { 100: "#fef3c7", 300: "#fcd34d", 500: "#d4a017", 600: "#b8860b" },
        // Guest page palette: Jaipur pink-city plaster, kumkum red, marigold, mehndi green
        gulabi: { 50: "#FDF3F1", 100: "#F8E4E1", 200: "#EFC9C3" },
        kumkum: { DEFAULT: "#8C1C2B", dark: "#6E1220", soft: "#F6DADD" },
        marigold: { DEFAULT: "#F2A30F", soft: "#FDEBC4" },
        mehndi: { DEFAULT: "#3F6B2A", soft: "#E3EEDB" },
        ink: "#2A1215",
      },
      fontFamily: {
        sans: ["Mukta", "Noto Sans Devanagari", "system-ui", "sans-serif"],
        display: ["Yatra One", "Mukta", "serif"],
      },
    },
  },
  plugins: [],
};

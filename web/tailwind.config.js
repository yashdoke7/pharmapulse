/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 900: "#0b1020", 800: "#131a2e", 700: "#1c2540", 600: "#273356" },
        mint: { 400: "#4ade9f", 500: "#22c98a", 600: "#12a771" },
        alert: { 400: "#fb7185", 500: "#f43f5e" },
        warn: { 400: "#fbbf24", 500: "#f59e0b" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

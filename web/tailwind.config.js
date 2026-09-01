/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm paper and warm near-black. Not grey, not navy - the warmth is
        // what stops it reading as a default dashboard.
        paper: {
          DEFAULT: "#F7F4EE",
          raised: "#FCFAF6",
          sunk: "#EFEBE2",
        },
        // Named rather than numbered: numeric keys collide with Tailwind's
        // opacity modifier inside @apply (border-ink/10 fails to resolve).
        ink: {
          DEFAULT: "#14110D",
          soft: "#3B362F",
          mute: "#6B6459",
          faint: "#9A9287",
          pale: "#C9C2B6",
        },
        // Structure comes from rules, so the rules are first-class tokens.
        line: {
          DEFAULT: "rgba(20, 17, 13, 0.13)",
          soft: "rgba(20, 17, 13, 0.07)",
          hard: "#14110D",
        },
        wash: {
          DEFAULT: "rgba(20, 17, 13, 0.030)",
          strong: "rgba(20, 17, 13, 0.065)",
        },
        // One accent per meaning, all deep and desaturated. No neon.
        signal: {
          red: "#A32E22",      // shortage - money walking out of the door
          amber: "#8A6410",    // watch
          green: "#1F5D42",    // healthy
          blue: "#1C4E7A",     // capital tied up
        },
      },
      fontFamily: {
        display: ["Instrument Serif", "Georgia", "serif"],
        sans: ["Inter Tight", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      letterSpacing: {
        micro: "0.16em",
      },
      maxWidth: {
        page: "1180px",
      },
    },
  },
  plugins: [],
};

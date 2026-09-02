/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Clinical medical theme tokens
        paper: {
          DEFAULT: "#F4FAFA",
          raised: "#FFFFFF",
          sunk: "#EBF5F6",
        },
        ink: {
          DEFAULT: "#172554", // Deep Navy
          soft: "#334155",    // Slate body
          mute: "#64748B",    // Secondary info
          faint: "#94A3B8",   // Subtle labels
          pale: "#CBD5E1",    // Muted borders
        },
        line: {
          DEFAULT: "rgba(15, 159, 168, 0.14)",
          soft: "rgba(15, 159, 168, 0.07)",
          hard: "#087F86",
        },
        wash: {
          DEFAULT: "rgba(15, 159, 168, 0.04)",
          strong: "rgba(15, 159, 168, 0.08)",
        },
        signal: {
          red: "#E11D48",      // Alert / shortage / critical
          amber: "#D97706",    // Warning / low stock
          green: "#059669",    // Healthy / growth
          blue: "#2563EB",     // Analytics / capital
        },
        medical: {
          teal: "#0F9FA8",
          "teal-deep": "#087F86",
          "teal-dark": "#055C62",
          blue: "#2F80ED",
          navy: "#172554",
          cyan: "#DDF5F5",
          "light-blue": "#E8F2FF",
          "soft-green": "#E6F7EF",
          "soft-amber": "#FFF4D6",
          "soft-red": "#FFE7E7",
        },
      },
      fontFamily: {
        display: ["Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
        sans: ["Inter", "Plus Jakarta Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
        card: "0 4px 20px -2px rgba(15, 159, 168, 0.06), 0 2px 6px -1px rgba(23, 37, 84, 0.04)",
        "card-hover": "0 12px 32px -4px rgba(15, 159, 168, 0.12), 0 4px 12px -2px rgba(23, 37, 84, 0.06)",
        float: "0 20px 40px -8px rgba(15, 159, 168, 0.14)",
        glow: "0 0 20px rgba(15, 159, 168, 0.25)",
      },
      borderRadius: {
        "card": "22px",
        "card-lg": "26px",
      },
      letterSpacing: {
        micro: "0.14em",
      },
      maxWidth: {
        page: "1360px",
      },
    },
  },
  plugins: [],
};

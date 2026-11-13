import type { Config } from "tailwindcss";

/**
 * Accessibility constraints from PRD Section 10 are encoded here, not left to
 * each component: 18 px minimum body text, and verdict colours that always
 * travel with an icon and a word.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Plus Jakarta Sans Variable"',
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          '"Segoe UI"',
          "Roboto",
          "sans-serif",
        ],
      },
      fontSize: {
        // base is 18px, not 16px: our primary user is 62 years old
        base: ["1.125rem", { lineHeight: "1.65rem" }],
        lg: ["1.25rem", { lineHeight: "1.8rem" }],
        xl: ["1.5rem", { lineHeight: "2rem" }],
        "2xl": ["1.875rem", { lineHeight: "2.25rem" }],
        "3xl": ["2.25rem", { lineHeight: "2.5rem" }],
      },
      colors: {
        verdict: {
          green: "#0f7a4a",
          greenbg: "#e4f6ec",
          red: "#b3261e",
          redbg: "#fdeceb",
          orange: "#9a5b00",
          orangebg: "#fdf1e0",
          grey: "#44474f",
          greybg: "#eef0f4",
        },
        ink: "#10141c",
        brand: { DEFAULT: "#1b4ddb", dark: "#13349c", soft: "#e8edfd", light: "#5b86ff" },
        surface: { DEFAULT: "#ffffff", dark: "#121826", raised: "#192132" },
        canvas: { DEFAULT: "#f3f5fa", dark: "#090d15" },
      },
      spacing: {
        // minimum comfortable tap target
        tap: "3.5rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,20,28,0.04), 0 6px 20px -8px rgba(16,20,28,0.10)",
        lift: "0 10px 30px -12px rgba(27,77,219,0.45)",
        nav: "0 -6px 24px -12px rgba(16,20,28,0.18)",
      },
      keyframes: {
        pulsebar: {
          "0%, 100%": { transform: "scaleY(0.35)" },
          "50%": { transform: "scaleY(1)" },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        ring: {
          "0%": { transform: "scale(0.85)", opacity: "0.55" },
          "100%": { transform: "scale(1.9)", opacity: "0" },
        },
        pop: {
          "0%": { transform: "scale(0.6)", opacity: "0" },
          "60%": { transform: "scale(1.08)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        sheet: {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        sweep: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(350%)" },
        },
      },
      animation: {
        pulsebar: "pulsebar 1s ease-in-out infinite",
        rise: "rise 0.28s ease-out both",
        ring: "ring 2.2s cubic-bezier(0.2, 0.6, 0.4, 1) infinite",
        pop: "pop 0.45s cubic-bezier(0.2, 0.8, 0.3, 1.2) both",
        sheet: "sheet 0.28s cubic-bezier(0.2, 0.8, 0.3, 1) both",
        sweep: "sweep 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;

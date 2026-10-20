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
          green: "#11784b",
          greenbg: "#e6f5ed",
          red: "#b3261e",
          redbg: "#fdeceb",
          orange: "#9a5b00",
          orangebg: "#fdf1e0",
          grey: "#44474f",
          greybg: "#eef0f4",
        },
        ink: "#13161c",
        brand: { DEFAULT: "#1b4ddb", dark: "#13349c", soft: "#e8edfd" },
      },
      spacing: {
        // minimum comfortable tap target
        tap: "3.5rem",
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
      },
      animation: {
        pulsebar: "pulsebar 1s ease-in-out infinite",
        rise: "rise 0.22s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0a0a0a",
        foreground: "#fafafa",
        primary: {
          DEFAULT: "#ff5757",
          light: "#ff7a7a",
          dark: "#d32f2f",
        },
        surface: {
          DEFAULT: "#141414",
          elevated: "#1a1a1a",
        },
        border: {
          DEFAULT: "rgba(255, 255, 255, 0.08)",
          light: "rgba(255, 255, 255, 0.15)",
        },
        success: "#10b981",
        warning: "#f59e0b",
        error: "#ef4444",
        info: "#3b82f6",
        muted: "rgba(255, 255, 255, 0.5)",
        // Map marker colors from the brief
        marker: {
          current: "#d32f2f",
          popoff: "#fbc02d",
          q3: "#1565c0",
          q2: "#0097a7",
          q1a: "#7b1fa2",
          b: "#666666",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;

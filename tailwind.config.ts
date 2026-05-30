import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#17202a",
        panel: "#f7f8fa",
        line: "#d9dee7",
        accent: "#2563eb",
        mint: "#0f766e",
        amber: "#b45309",
        danger: "#b91c1c"
      }
    }
  },
  plugins: []
};

export default config;

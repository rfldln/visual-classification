import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#e11d48",
          hover: "#be123c",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;

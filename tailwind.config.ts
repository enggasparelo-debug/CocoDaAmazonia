import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        coco: {
          50: "#f1faf3",
          100: "#dcf2e2",
          200: "#bbe4c8",
          300: "#8dcfa3",
          400: "#5fb37c",
          500: "#3d985f",
          600: "#2c7a4a",
          700: "#25613d",
          800: "#1f4d33",
          900: "#1a402b",
        },
      },
    },
  },
  plugins: [],
};

export default config;

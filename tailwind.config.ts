import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // New York: titles, hero, page headings, modal titles
        display: ['"Abbode New York"', "serif"],
        // Paris: stylized italic accents
        paris: ['"Abbode Paris"', "serif"],
        // Berlin: body text (also Tailwind's default `font-sans`)
        sans: ['"Abbode Berlin"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        // Brand palette — use these directly when picking the right hue
        porcelain:  "#FFFCF7",
        parchment:  "#F5F0EB",
        pink: {
          DEFAULT: "#F2B2AE",
          soft:    "#FBE3E1",
          deep:    "#E89691",
        },
        berry:      "#BB3767",
        cherry:     "#972945",
        plum:       "#671E30",
        espresso:   "#432222",
        sage:       "#D1C68F",
        olive:      "#7D6E35",
        chartreuse: "#E7E57E",
        lilac:      "#C398B5",
        tomato:     "#BF3333",

        // Backwards-compat aliases so existing class names still resolve cleanly.
        cream: {
          50:  "#FFFCF7", // porcelain
          100: "#F5F0EB", // parchment
          200: "#E6DDD2", // border tint
        },
        ink: {
          DEFAULT: "#432222", // espresso
          soft:    "#6B4848",
          muted:   "#9C8181",
        },
        bark: {
          50:  "#FBE3E1", // pink-soft
          200: "#F2B2AE", // pink
          500: "#BB3767", // berry
          700: "#972945", // cherry
          900: "#671E30", // plum
        },
      },
      letterSpacing: { tightest: "-0.03em" },
    },
  },
  plugins: [],
};

export default config;

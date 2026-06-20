/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        ink: {
          950: "#0a0a0b",
          900: "#0f0f11",
          800: "#18181b",
          700: "#27272a",
          600: "#3f3f46",
        },
        amber: {
          DEFAULT: "#f59e0b",
          glow: "#fbbf24",
        },
        emerald: {
          DEFAULT: "#10b981",
          glow: "#34d399",
        },
        danger: "#ef4444",
      },
      fontFamily: {
        display: ['"Chakra Petch"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        "glow-amber": "0 0 0 1px rgba(245,158,11,0.5), 0 0 18px rgba(245,158,11,0.25)",
        "glow-emerald": "0 0 0 1px rgba(16,185,129,0.5), 0 0 18px rgba(16,185,129,0.25)",
        "glow-danger": "0 0 0 1px rgba(239,68,68,0.6), 0 0 22px rgba(239,68,68,0.35)",
      },
      backgroundImage: {
        "grid-lines":
          "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
        "radial-fade":
          "radial-gradient(circle at 50% 0%, rgba(245,158,11,0.10), transparent 55%)",
      },
      backgroundSize: {
        "grid-32": "32px 32px",
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        scanline: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        flickerIn: {
          "0%": { opacity: "0", transform: "scale(0.9)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        pulseGlow: "pulseGlow 1.6s ease-in-out infinite",
        scanline: "scanline 6s linear infinite",
        flickerIn: "flickerIn 0.18s ease-out",
      },
    },
  },
  plugins: [],
};

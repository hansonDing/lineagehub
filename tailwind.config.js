/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        // 主色 — 青墨(Petrol Teal),见 design.md §4.1
        primary: {
          50: '#F0FDFA',
          100: '#CCFBF1',
          300: '#5EEAD4',
          400: '#2DD4BF',
          600: '#0D9488',
          700: '#0F766E',
          800: '#115E59',
          DEFAULT: '#0F766E',
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // 语义状态色,见 design.md §4.3
        success: { DEFAULT: '#16A34A', light: '#F0FDF4', dark: '#15803D' },
        pending: { DEFAULT: '#D97706', light: '#FFFBEB' },
        danger: { DEFAULT: '#DC2626', light: '#FEF2F2', border: '#FCA5A5' },
        sqlwarn: { DEFAULT: '#EA580C', light: '#FFF7ED' },
        info: { DEFAULT: '#2563EB', light: '#EFF6FF' },
        // 数仓分层色,见 design.md §4.4
        layer: {
          ods: '#6E8199',
          dim: '#9C8E7E',
          dwd: '#4E8FD9',
          dws: '#3FA97C',
          ads: '#C9A23F',
          other: '#8A94A6',
        },
        // 深色专用
        ink: '#0C1222',      // 侧导航底
        canvas: '#0A101F',   // 血缘画布底
        editor: '#0B1220',   // 代码编辑区底
      },
      fontFamily: {
        sans: [
          '-apple-system',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Noto Sans SC"',
          '"Source Han Sans SC"',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          '"SFMono-Regular"',
          '"SF Mono"',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          'monospace',
        ],
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      transitionDuration: {
        120: '120ms',
        180: '180ms',
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        card: '0 1px 2px rgba(15,23,42,0.04)',
        overlay: '0 8px 24px rgba(15,23,42,0.12)',
        modal: '0 16px 48px rgba(15,23,42,0.18)',
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
        "pulse-soft": {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
        "pulse-soft": "pulse-soft 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}

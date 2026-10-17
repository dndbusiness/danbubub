import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['postgres', 'pdf-parse', 'playwright', '@anthropic-ai/sdk'],
  // הגופן העברי לטפסי PDF (lib/sign/pdf.ts) וספריית ההסכמים (lib/sign/library.ts) נקראים מהדיסק — שייכללו בפונקציות של Vercel
  outputFileTracingIncludes: { '/**': ['./assets/fonts/**', './data/agreements/**'] },
  // lib/rules מיובא עם סיומת .js (ESM תקני, כמו ב-vitest). webpack צריך
  // לדעת לפתור אותה ל-.ts — אחרת יש שני סגנונות ייבוא לאותו קוד.
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return cfg
  },
}

export default config

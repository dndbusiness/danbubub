import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['postgres', 'pdf-parse', 'playwright', '@anthropic-ai/sdk', 'mupdf'],
  // הגופן העברי לטפסי PDF (lib/sign/pdf.ts) וספריית ההסכמים (lib/sign/library.ts) נקראים מהדיסק — שייכללו בפונקציות של Vercel
  // + דף ה-CRM (app/crm/route.ts קורא אותו מהדיסק) וטפסי הגופים — שתמיד ייכללו בגרסה החדשה
  outputFileTracingIncludes: {
    '/**': ['./assets/fonts/**', './data/agreements/**', './crm/**', './data/sign-forms/**'],
    // עורך ה-PDF: MuPDF נטען כ-ESM עם קובץ wasm לידו (new URL(..., import.meta.url)) — שייכלל בפונקציה
    '/api/crm/pdf/**': ['./node_modules/mupdf/dist/mupdf.js', './node_modules/mupdf/dist/mupdf-wasm.js', './node_modules/mupdf/dist/mupdf-wasm.wasm', './node_modules/mupdf/package.json'],
  },
  // lib/rules מיובא עם סיומת .js (ESM תקני, כמו ב-vitest). webpack צריך
  // לדעת לפתור אותה ל-.ts — אחרת יש שני סגנונות ייבוא לאותו קוד.
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return cfg
  },
}

export default config

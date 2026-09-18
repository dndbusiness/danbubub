import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['postgres'],
  // lib/rules מיובא עם סיומת .js (ESM תקני, כמו ב-vitest). webpack צריך
  // לדעת לפתור אותה ל-.ts — אחרת יש שני סגנונות ייבוא לאותו קוד.
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return cfg
  },
}

export default config

import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Sidebar } from '@/components/shell/sidebar'
import { BottomNav } from '@/components/shell/bottom-nav'

export const metadata: Metadata = {
  title: 'הר-אל — כספים',
  description: 'מערכת הכספים הפנימית של הר-אל',
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-bg text-text">
        <div className="flex min-h-dvh">
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col pb-16 md:pb-0">{children}</div>
        </div>
        <BottomNav />
      </body>
    </html>
  )
}

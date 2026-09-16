import './globals.css'

const TITLE = 'GetMyPhotos — find every photo of you from the event'
const DESCRIPTION =
  'Guests scan a QR code, take a selfie, and get every photo of themselves from the wedding — in under 60 seconds. No app, no password.'

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL('https://getmyphotos.in'),
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', locale: 'en_IN' },
  robots: { index: true, follow: true },
}

export const viewport = { themeColor: '#8c141e', width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      {/* System fonts only — no webfont request, so first paint is instant on 3G */}
      <body>{children}</body>
    </html>
  )
}

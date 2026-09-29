import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './styles.css';
import './tailor.css';
import './profiles.css';

export const metadata: Metadata = {
  title: 'Job Engine | Hassaan Nasir',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%237c6cff'/><path d='M9 17l5 5 9-12' stroke='white' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>"
  }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets the layout extend under the iPhone notch / home indicator (safe areas are padded in CSS)
  viewportFit: 'cover',
  themeColor: '#f6f7fb'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The client script sets data-theme / data-builtin after load
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" />
      </head>
      <body data-builtin="true" suppressHydrationWarning>
        {children}
        <Script src="/js/kairo.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}

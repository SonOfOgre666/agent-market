import './globals.css'
import { ToastProvider } from '../components/Toast.js'
import { AuthProvider } from '../components/AuthProvider.js'
import { WorkspaceSettingsProvider } from '../components/WorkspaceSettingsProvider.js'
import { RealtimeProvider } from '../components/RealtimeProvider.js'

export const metadata = {
  title: 'Agent Market — Social Media Management',
  description: 'Self-hosted social media management',
  icons: {
    icon: '/img/logo.png',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Naskh+Arabic:wght@500;600;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>
          <WorkspaceSettingsProvider>
            <ToastProvider>
              <RealtimeProvider>
                {children}
              </RealtimeProvider>
            </ToastProvider>
          </WorkspaceSettingsProvider>
        </AuthProvider>
      </body>
    </html>
  )
}

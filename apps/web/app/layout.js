import './globals.css'
import { ToastProvider } from '../components/Toast.js'
import { AuthProvider } from '../components/AuthProvider.js'

export const metadata = {
  title: 'Agent Market — Social Media Management',
  description: 'Self-hosted social media management',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}

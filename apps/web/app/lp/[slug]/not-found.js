export default function LandingPageNotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0f0f11',
      color: '#e2e8f0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      textAlign: 'center',
      padding: '2rem',
    }}>
      <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>404</div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem', color: '#f1f5f9' }}>
        Page not found
      </h1>
      <p style={{ color: '#64748b', maxWidth: 400, lineHeight: 1.6 }}>
        This landing page doesn't exist or may have been unpublished. Check the link and try again.
      </p>
    </div>
  )
}

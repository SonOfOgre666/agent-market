'use client'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4010'

function isNgrokUrl(url) {
  try {
    const host = new URL(url).hostname
    return host.endsWith('ngrok-free.dev') || host.endsWith('ngrok.io') || host.endsWith('ngrok.app')
  } catch {
    return false
  }
}

const NGROK_SKIP_WARNING_HEADERS = isNgrokUrl(API_URL)
  ? { 'ngrok-skip-browser-warning': 'true' }
  : {}

function LandingPageContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const slug = params.slug

  const [page, setPage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [form, setForm] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  // Read UTM params from URL
  const utm = {
    source: searchParams.get('utm_source') || '',
    medium: searchParams.get('utm_medium') || '',
    campaign: searchParams.get('utm_campaign') || '',
    term: searchParams.get('utm_term') || '',
    content: searchParams.get('utm_content') || '',
  }

  useEffect(() => {
    fetch(`${API_URL}/api/ads/landing-pages/${slug}`, {
      headers: { ...NGROK_SKIP_WARNING_HEADERS },
    })
      .then(res => {
        if (res.status === 404) { setNotFound(true); setLoading(false); return null }
        return res.json()
      })
      .then(data => {
        if (!data) return
        if (data.error) { setNotFound(true) } else { setPage(data) }
        setLoading(false)
      })
      .catch(() => { setNotFound(true); setLoading(false) })
  }, [slug])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`${API_URL}/api/ads/landing-pages/${slug}/lead`, {
        method: 'POST',
        headers: {
          ...NGROK_SKIP_WARNING_HEADERS,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: form, utm }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Submission failed')
      setSubmitted(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (notFound) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#e2e8f0', textAlign: 'center' }}>
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>404</div>
        <div style={{ fontSize: '1.25rem', color: '#94a3b8' }}>This page doesn't exist or is no longer available.</div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      {/* Hero */}
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '4rem 1.5rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          {page.headline && (
            <h1 style={{ fontSize: 'clamp(1.75rem, 5vw, 3rem)', fontWeight: 800, lineHeight: 1.15, marginBottom: '1rem', background: 'linear-gradient(135deg, #a78bfa, #6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {page.headline}
            </h1>
          )}
          {page.subheadline && (
            <p style={{ fontSize: '1.125rem', color: '#94a3b8', maxWidth: 500, margin: '0 auto' }}>
              {page.subheadline}
            </p>
          )}
          {page.body && (
            <p style={{ marginTop: '1.5rem', color: '#cbd5e1', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {page.body}
            </p>
          )}
        </div>

        {/* Lead capture form */}
        <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '2rem', backdropFilter: 'blur(12px)' }}>
          {submitted ? (
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✓</div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', color: '#10b981' }}>You're in!</h2>
              <p style={{ color: '#94a3b8' }}>Thank you for submitting. We'll be in touch soon.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.5rem', textAlign: 'center' }}>
                {page.cta_text || 'Get Started'}
              </h2>

              {error && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', color: '#fca5a5', fontSize: '0.875rem' }}>
                  {error}
                </div>
              )}

              {(page.form_fields || []).map((field) => (
                <div key={field.name} style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem', color: '#cbd5e1' }}>
                    {field.label}{field.required && <span style={{ color: '#ef4444', marginLeft: '0.2rem' }}>*</span>}
                  </label>
                  {field.type === 'textarea' ? (
                    <textarea
                      required={field.required}
                      rows={3}
                      value={form[field.name] || ''}
                      onChange={e => setForm(f => ({ ...f, [field.name]: e.target.value }))}
                      style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '0.625rem 0.875rem', color: '#e2e8f0', fontSize: '0.9rem', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                    />
                  ) : (
                    <input
                      type={field.type || 'text'}
                      required={field.required}
                      value={form[field.name] || ''}
                      onChange={e => setForm(f => ({ ...f, [field.name]: e.target.value }))}
                      style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '0.625rem 0.875rem', color: '#e2e8f0', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                    />
                  )}
                </div>
              ))}

              <button
                type="submit"
                disabled={submitting}
                style={{ width: '100%', marginTop: '0.5rem', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', borderRadius: 10, padding: '0.875rem', color: '#fff', fontSize: '1rem', fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}
              >
                {submitting ? 'Submitting...' : page.cta_text || 'Submit'}
              </button>
            </form>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: '2rem', fontSize: '0.75rem', color: '#475569' }}>
          Powered by Agent Market
        </div>
      </div>
    </div>
  )
}

export default function LandingPageRoute() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#94a3b8' }}>Loading...</div>
      </div>
    }>
      <LandingPageContent />
    </Suspense>
  )
}

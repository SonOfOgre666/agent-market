'use client'
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../../components/AuthProvider.js'
import { useToast } from '../../components/Toast.js'
import { Lock, Mail, User, LogIn } from 'lucide-react'
import BrandLogo from '../../components/BrandLogo.js'

function RegisterForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { login } = useAuth()
  const toast = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const inviteToken = searchParams.get('invite')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!name || !email || !password) {
      setError('All fields are required')
      return
    }

    if (password !== passwordConfirm) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)
    try {
      await login(email, password, { name, register: true, invite_token: inviteToken })
      router.push('/')
    } catch (err) {
      setError(err.message || 'Registration failed')
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
            <BrandLogo size={64} style={{ borderRadius: '0.875rem', boxShadow: '0 4px 24px rgba(99, 102, 241, 0.25)' }} />
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#6366f1' }}>Agent Market</h1>
          <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
            {inviteToken ? 'You\'ve been invited — create your account to join' : 'Create your account'}
          </p>
        </div>
        <div className="card">
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{ fontSize: '0.875rem', color: '#dc2626', marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fee2e2', borderRadius: '0.375rem' }}>
                {error}
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <div className="form-input-group">
                <input className="form-input" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="John Doe" required autoFocus />
                <div className="form-input-icon"><User size={14} strokeWidth={2} /></div>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <div className="form-input-group">
                <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" required />
                <div className="form-input-icon"><Mail size={14} strokeWidth={2} /></div>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <div className="form-input-group">
                <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" required />
                <div className="form-input-icon"><Lock size={14} strokeWidth={2} /></div>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <div className="form-input-group">
                <input className="form-input" type="password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} placeholder="Confirm password" required />
                <div className="form-input-icon"><Lock size={14} strokeWidth={2} /></div>
              </div>
            </div>
            <button className="btn btn-primary w-full" type="submit" disabled={loading} style={{ justifyContent: 'center' }}>
              {loading ? <span className="spinner" /> : <><LogIn size={14} strokeWidth={2} /> Create Account</>}
            </button>
          </form>
          <div style={{ textAlign: 'center', marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-muted text-sm">
              Already have an account?{' '}
              <Link href="/login" style={{ color: '#6366f1', textDecoration: 'none', fontWeight: 500 }}>
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  )
}

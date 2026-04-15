'use client'
import { useState } from 'react'
import AppLayout from '../../components/AppLayout.js'
import { api } from '../../lib/api.js'
import { useAuth } from '../../components/AuthProvider.js'
import { useToast } from '../../components/Toast.js'

export default function ProfilePage() {
  const { user, setUser } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPw, setSavingPw] = useState(false)

  const saveProfile = async (e) => {
    e.preventDefault()
    setSavingProfile(true)
    try {
      const updated = await api.updateProfile({ name, email })
      setUser(updated)
      toast.success('Profile updated')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingProfile(false)
    }
  }

  const changePassword = async (e) => {
    e.preventDefault()
    setSavingPw(true)
    try {
      await api.changePassword({ current_password: currentPw, password: newPw, password_confirmation: confirmPw })
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      toast.success('Password changed')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingPw(false)
    }
  }

  return (
    <AppLayout>
      <div className="page-header"><h1 className="page-title">Profile</h1></div>
      <div className="grid-2" style={{ maxWidth: 800 }}>
        <div className="card">
          <div className="card-title">Account Details</div>
          <form onSubmit={saveProfile}>
            <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={name} onChange={e => setName(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
            <button className="btn btn-primary" type="submit" disabled={savingProfile}>{savingProfile ? <span className="spinner" /> : 'Save'}</button>
          </form>
        </div>
        <div className="card">
          <div className="card-title">Change Password</div>
          <form onSubmit={changePassword}>
            <div className="form-group"><label className="form-label">Current Password</label><input className="form-input" type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">New Password</label><input className="form-input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Confirm Password</label><input className="form-input" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} /></div>
            <button className="btn btn-primary" type="submit" disabled={savingPw}>{savingPw ? <span className="spinner" /> : 'Change Password'}</button>
          </form>
        </div>
      </div>
    </AppLayout>
  )
}

'use client'
import { useState, useEffect, useRef } from 'react'
import AppLayout from '../../components/AppLayout.js'
import { useToast } from '../../components/Toast.js'
import { api } from '../../lib/api.js'

export default function TeamPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)
  const [lastInviteUrl, setLastInviteUrl] = useState(null)
  const [workspaceName, setWorkspaceName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const toast = useToast()

  const load = async () => {
    try {
      const res = await api.workspace()
      setData(res)
      setWorkspaceName(res.workspace.name)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleInvite = async (e) => {
    e.preventDefault()
    if (!inviteEmail) return
    setInviting(true)
    try {
      const invite = await api.inviteMember(inviteEmail, inviteRole)
      setLastInviteUrl(invite.invite_url)
      toast.success(`Invite created for ${invite.email} — copy the link below`)
      setInviteEmail('')
      await load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setInviting(false)
    }
  }

  const handleRevokeInvite = async (token) => {
    try {
      await api.revokeInvite(token)
      toast.success('Invite revoked')
      await load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleRemoveMember = async (userId) => {
    if (!confirm('Remove this member from the workspace?')) return
    try {
      await api.removeMember(userId)
      toast.success('Member removed')
      await load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleRoleChange = async (userId, role) => {
    try {
      await api.updateMemberRole(userId, role)
      toast.success('Role updated')
      await load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleSaveName = async (e) => {
    e.preventDefault()
    setSavingName(true)
    try {
      await api.updateWorkspace({ name: workspaceName })
      toast.success('Workspace name updated')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingName(false)
    }
  }

  if (loading) return (
    <AppLayout>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
        <div className="spinner" />
      </div>
    </AppLayout>
  )

  const { workspace, members, invites } = data || {}

  return (
    <AppLayout>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Team</h1>
          <p style={{ color: 'var(--fg-muted)', marginTop: '0.25rem', fontSize: '0.875rem' }}>
            Manage your workspace members and invitations
          </p>
        </div>

        {/* Workspace name */}
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Workspace Settings</h2>
          <form onSubmit={handleSaveName} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="form-label">Workspace Name</label>
              <input
                className="form-input"
                value={workspaceName}
                onChange={e => setWorkspaceName(e.target.value)}
                placeholder="My Workspace"
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={savingName}>
              {savingName ? <span className="spinner" /> : 'Save'}
            </button>
          </form>
        </div>

        {/* Invite new member */}
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Invite Member</h2>
          <form onSubmit={handleInvite} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="form-label">Email Address</label>
              <input
                className="form-input"
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Role</label>
              <select className="form-input" value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ minWidth: 100 }}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button className="btn btn-primary" type="submit" disabled={inviting}>
              {inviting ? <span className="spinner" /> : 'Send Invite'}
            </button>
          </form>

          {lastInviteUrl && (
            <div style={{ marginTop: '1rem', padding: '0.875rem', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--primary-glow)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.5rem' }}>
                Invite link — share this with your teammate:
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  className="form-input"
                  readOnly
                  value={lastInviteUrl}
                  style={{ flex: 1, fontSize: '0.8rem', fontFamily: 'monospace' }}
                  onFocus={e => e.target.select()}
                />
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => { navigator.clipboard.writeText(lastInviteUrl); toast.success('Copied!') }}
                >
                  Copy
                </button>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--fg-muted)', marginTop: '0.4rem' }}>
                {process.env.NEXT_PUBLIC_MAIL_CONFIGURED === 'true'
                  ? 'An email was also sent to the invitee.'
                  : 'Email not configured — send this link manually.'}
              </div>
            </div>
          )}
        </div>

        {/* Members list */}
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
            Members <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: '0.875rem' }}>({members?.length || 0})</span>
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {members?.map(m => (
              <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 8 }}>
                <div className="avatar" style={{ flexShrink: 0, width: 36, height: 36, fontSize: '0.875rem' }}>
                  {m.name?.[0]?.toUpperCase() || '?'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{m.name || 'Unknown'}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>{m.email}</div>
                </div>
                {m.role === 'owner' ? (
                  <span className="badge badge-info">Owner</span>
                ) : (
                  <select
                    className="form-input"
                    value={m.role}
                    onChange={e => handleRoleChange(m.user_id, e.target.value)}
                    style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', width: 'auto' }}
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                )}
                {m.role !== 'owner' && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleRemoveMember(m.user_id)}
                    style={{ color: 'var(--danger)', padding: '0.25rem 0.5rem' }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Pending invites */}
        {invites?.length > 0 && (
          <div className="card">
            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
              Pending Invites <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: '0.875rem' }}>({invites.length})</span>
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {invites.map(inv => (
                <div key={inv.token} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{inv.email}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
                      {inv.role} · Expires {new Date(inv.expires_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleRevokeInvite(inv.token)}
                    style={{ color: 'var(--danger)' }}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

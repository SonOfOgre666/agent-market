'use client'
import { useState, useEffect } from 'react'
import AppLayout from '../../components/AppLayout.js'
import { useAuth } from '../../components/AuthProvider.js'
import { useToast } from '../../components/Toast.js'
import { api } from '../../lib/api.js'
import { useConfirmDialog } from '../../lib/useConfirmDialog.js'
import { useWorkspaceSettings } from '../../components/WorkspaceSettingsProvider.js'
import { isWorkspaceAdmin, workspaceRoleBadgeClass, workspaceRoleLabel } from '../../lib/workspaceRoles.js'
import { Users, Building2, Send, Copy, Trash2, UserX } from 'lucide-react'

export default function TeamPage() {
  const { user } = useAuth()
  const canManage = isWorkspaceAdmin(user?.workspace?.role)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)
  const [lastInviteUrl, setLastInviteUrl] = useState(null)
  const { formatDateTime } = useWorkspaceSettings()
  const [workspaceName, setWorkspaceName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const toast = useToast()
  const { confirm, ConfirmDialogHost } = useConfirmDialog()

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
    const ok = await confirm({
      title: 'Remove member?',
      message: 'Remove this member from the workspace? They will lose access immediately.',
      confirmLabel: 'Remove',
    })
    if (!ok) return
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
        <div className="page-header-enhanced" style={{ marginBottom: '2rem' }}>
          <div className="page-header-content">
            <div className="page-header-title">
              <div className="page-header-icon">
                <Users size={18} strokeWidth={2.5} />
              </div>
              <h1 className="page-title">Team</h1>
            </div>
            <p className="page-header-desc">
              {canManage
                ? 'Manage your workspace members and invitations'
                : 'The workspace members'}
            </p>
          </div>
        </div>

        {canManage && (
          <>
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
              {savingName ? <span className="spinner" /> : <><Building2 size={14} strokeWidth={2} /> Save</>}
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
              {inviting ? <span className="spinner" /> : <><Send size={14} strokeWidth={2} /> Send Invite</>}
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
                  <Copy size={12} strokeWidth={2} /> Copy
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
          </>
        )}

        {/* Members list — visible to all workspace members */}
        <div className="card" style={{ marginBottom: canManage && invites?.length > 0 ? '1.5rem' : 0 }}>
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
                {canManage && m.role === 'owner' ? (
                  <span className="badge badge-info">Owner</span>
                ) : canManage ? (
                  <>
                  <select
                    className="form-input"
                    value={m.role}
                    onChange={e => handleRoleChange(m.user_id, e.target.value)}
                    style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', width: 'auto' }}
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleRemoveMember(m.user_id)}
                    style={{ color: 'var(--danger)', padding: '0.25rem 0.5rem' }}
                  >
                    <UserX size={12} strokeWidth={2} /> Remove
                  </button>
                  </>
                ) : (
                  <span className={workspaceRoleBadgeClass(m.role)}>{workspaceRoleLabel(m.role)}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {canManage && invites?.length > 0 && (
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
                      {inv.role} · Expires {formatDateTime(inv.expires_at, { style: 'date-only' })}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleRevokeInvite(inv.token)}
                    style={{ color: 'var(--danger)' }}
                  >
                    <Trash2 size={12} strokeWidth={2} /> Revoke
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {canManage && <ConfirmDialogHost />}
    </AppLayout>
  )
}

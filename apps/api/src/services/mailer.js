import nodemailer from 'nodemailer'

function createTransport() {
  const host = process.env.MAIL_HOST
  const port = parseInt(process.env.MAIL_PORT || '587')
  const user = process.env.MAIL_USERNAME
  const pass = process.env.MAIL_PASSWORD
  const from = process.env.MAIL_FROM_ADDRESS || user
  const fromName = process.env.MAIL_FROM_NAME || 'Agent Market'

  if (!host || !user || !pass) {
    return null
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })

  return { transport, from: `"${fromName}" <${from}>` }
}

export async function sendInviteEmail({ to, inviterName, workspaceName, inviteUrl, role }) {
  const mailer = createTransport()

  if (!mailer) {
    console.warn('[Mailer] Email not configured — MAIL_HOST, MAIL_USERNAME, MAIL_PASSWORD required. Invite URL:', inviteUrl)
    return { skipped: true, invite_url: inviteUrl }
  }

  const roleLabel = role === 'admin' ? 'Admin' : 'Member'

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f11; color: #e2e8f0; margin: 0; padding: 40px 20px; }
    .container { max-width: 520px; margin: 0 auto; }
    .card { background: #1a1a2e; border: 1px solid #2a2a3e; border-radius: 12px; padding: 40px; }
    .logo { font-size: 1.5rem; font-weight: 700; color: #6366f1; margin-bottom: 32px; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 12px; color: #f1f5f9; }
    p { color: #94a3b8; line-height: 1.6; margin: 0 0 20px; font-size: 0.9rem; }
    .badge { display: inline-block; background: #6366f120; color: #818cf8; border: 1px solid #6366f140; border-radius: 6px; padding: 4px 10px; font-size: 0.8rem; font-weight: 500; margin-bottom: 24px; }
    .btn { display: inline-block; background: #6366f1; color: #fff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 0.9rem; margin: 8px 0 24px; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #2a2a3e; font-size: 0.75rem; color: #64748b; }
    .url { word-break: break-all; font-size: 0.75rem; color: #475569; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">Agent Market</div>
      <div class="badge">${roleLabel} Invitation</div>
      <h1>You've been invited to join ${workspaceName}</h1>
      <p>
        <strong style="color:#e2e8f0">${inviterName}</strong> has invited you to collaborate on
        <strong style="color:#e2e8f0">${workspaceName}</strong> on Agent Market — a social media scheduling platform.
      </p>
      <p>You'll join as a <strong style="color:#e2e8f0">${roleLabel}</strong>. Click the button below to create your account and get started:</p>
      <a href="${inviteUrl}" class="btn">Accept Invitation</a>
      <p style="font-size:0.8rem">This invite expires in 7 days.</p>
      <div class="footer">
        If you weren't expecting this invitation, you can safely ignore this email.
        <div class="url">${inviteUrl}</div>
      </div>
    </div>
  </div>
</body>
</html>`

  const text = `You've been invited to join ${workspaceName} on Agent Market.

${inviterName} has invited you as a ${roleLabel}.

Accept the invitation here:
${inviteUrl}

This invite expires in 7 days. If you weren't expecting this, ignore this email.`

  await mailer.transport.sendMail({
    from: mailer.from,
    to,
    subject: `${inviterName} invited you to ${workspaceName} on Agent Market`,
    html,
    text,
  })

  console.log(`[Mailer] Invite email sent to ${to}`)
  return { sent: true }
}

export async function sendWeeklyReport({ to, workspaceName, weekLabel, stats }) {
  const mailer = createTransport()
  if (!mailer) {
    console.warn('[Mailer] Weekly report skipped — email not configured')
    return { skipped: true }
  }

  const fmt$ = (v) => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
  const fmtN = (v) => v != null ? Number(v).toLocaleString() : '—'
  const fmtPct = (v) => v != null ? `${Number(v).toFixed(1)}%` : '—'

  const kpiRows = [
    { label: 'Total Budget', value: fmt$(stats.total_budget) },
    { label: 'Total Spend', value: fmt$(stats.total_spend) },
    { label: 'Budget Remaining', value: fmt$(stats.budget_remaining), alert: stats.budget_remaining < 0 },
    { label: 'Impressions', value: fmtN(stats.total_impressions) },
    { label: 'Clicks', value: fmtN(stats.total_clicks) },
    { label: 'CTR', value: fmtPct(stats.ctr) },
    { label: 'CPC', value: stats.cpc ? fmt$(stats.cpc) : '—' },
    { label: 'Conversions', value: fmtN(stats.total_conversions) },
    { label: 'CPA', value: stats.cpa ? fmt$(stats.cpa) : '—' },
    { label: 'Active Campaigns', value: fmtN(stats.active_campaigns) },
    { label: 'Posts Published', value: fmtN(stats.posts_published) },
    { label: 'Posts Scheduled', value: fmtN(stats.posts_scheduled) },
  ]

  const rowsHtml = kpiRows.map(r => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #1e2640;color:#94a3b8;font-size:0.85rem;">${r.label}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #1e2640;text-align:right;font-weight:600;font-size:0.85rem;color:${r.alert ? '#ef4444' : '#f1f5f9'};">${r.value}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f11;color:#e2e8f0;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:#1a1a2e;border:1px solid #2a2a3e;border-radius:12px;padding:40px;">
      <div style="font-size:1.4rem;font-weight:700;color:#6366f1;margin-bottom:8px;">Agent Market</div>
      <div style="font-size:0.8rem;color:#64748b;margin-bottom:28px;">Weekly KPI Report</div>
      <h1 style="font-size:1.1rem;font-weight:600;color:#f1f5f9;margin:0 0 4px;">${workspaceName}</h1>
      <p style="color:#64748b;font-size:0.85rem;margin:0 0 24px;">${weekLabel}</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #1e2640;border-radius:8px;overflow:hidden;">
        ${rowsHtml}
      </table>
      <div style="margin-top:28px;padding-top:20px;border-top:1px solid #2a2a3e;font-size:0.75rem;color:#475569;text-align:center;">
        You're receiving this because you're a member of ${workspaceName} on Agent Market.
      </div>
    </div>
  </div>
</body>
</html>`

  const text = `Agent Market — Weekly KPI Report\n${workspaceName} | ${weekLabel}\n\n${kpiRows.map(r => `${r.label}: ${r.value}`).join('\n')}`

  for (const recipient of (Array.isArray(to) ? to : [to])) {
    await mailer.transport.sendMail({
      from: mailer.from,
      to: recipient,
      subject: `Weekly Report: ${workspaceName} — ${weekLabel}`,
      html,
      text,
    })
    console.log(`[Mailer] Weekly report sent to ${recipient}`)
  }
  return { sent: true }
}

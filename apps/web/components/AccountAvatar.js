import { SocialConnectIcon } from './SocialConnectIcon.js'

function providerColorClass(provider) {
  if (provider === 'facebook_page') return 'provider-facebook'
  if (provider === 'instagram_login') return 'provider-instagram_login'
  return `provider-${provider}`
}

export function AccountAvatar({ account, className = 'avatar' }) {
  const provider = account?.provider
  if (account?.media?.avatar) {
    return <img src={account.media.avatar} className={className} alt="" />
  }
  return (
    <div className={`${className} ${providerColorClass(provider)}`}>
      <SocialConnectIcon provider={provider} size={18} />
    </div>
  )
}

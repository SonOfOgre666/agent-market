const LOGO_SRC = '/img/agent-market.png'

export default function BrandLogo({ size = 48, className = '', style = {} }) {
  return (
    <img
      src={LOGO_SRC}
      alt="Agent Market"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'cover', flexShrink: 0, ...style }}
    />
  )
}

'use client'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '../lib/api.js'
import { canSelectAccountForPost, filterSelectableAccountIds } from '../lib/accountKinds.js'
import { useToast } from './Toast.js'
import { useConfirmDialog } from '../lib/useConfirmDialog.js'
import { useWorkspaceSettings } from './WorkspaceSettingsProvider.js'
import MediaPicker from './MediaPicker.js'
import {
  Image, Link2, Target, MessageSquare, Star, CalendarClock,
  Trash2, Users, SquarePen, CircleHelp, Eye, Hash,
  AlertCircle, AlertTriangle, Sparkles, X as XIcon, Video,
  CheckCircle2, ChevronLeft, ChevronRight,
  MoreHorizontal, Globe2,
} from 'lucide-react'

const PROVIDER_LIMITS = {
  twitter: 280, facebook: 5000, instagram: 2200,
  instagram_login: 2200, tiktok: 2200, linkedin: 3000,
}

const PLATFORM_INFO = {
  facebook:        { label: 'Facebook',   color: '#1877f2', mediaRequired: false, supportsLink: true,  supportsTargeting: true,  supportsStory: false },
  instagram:       { label: 'Instagram',  color: '#e1306c', mediaRequired: true,  supportsLink: false, supportsTargeting: false, supportsStory: true  },
  instagram_login: { label: 'Instagram',  color: '#e1306c', mediaRequired: true,  supportsLink: false, supportsTargeting: false, supportsStory: true  },
  twitter:         { label: 'X / Twitter',color: '#1d9bf0', mediaRequired: false, supportsLink: true,  supportsTargeting: false, supportsStory: false },
  tiktok:          { label: 'TikTok',     color: '#ff0050', mediaRequired: true,  supportsLink: false, supportsTargeting: false, supportsStory: false, videoOnly: true },
  linkedin:        { label: 'LinkedIn',   color: '#0a66c2', mediaRequired: false, supportsLink: true,  supportsTargeting: false, supportsStory: false },
}

const INSTAGRAM_PROVIDERS = ['instagram', 'instagram_login']

const TEMPLATE_FB_ICONS = {
  like: '/img/facebook_icons/like.png',
  comment: '/img/facebook_icons/comment.png',
  share: '/img/facebook_icons/share.png',
  reactions: '/img/facebook_icons/reactions.png',
}
const TEMPLATE_IG_ICONS = {
  like: '/img/instagram_icons/like.png',
  comment: '/img/instagram_icons/comment.png',
  share: '/img/instagram_icons/share.png',
  save: '/img/instagram_icons/save.png',
}
const TEMPLATE_LI_ICONS = {
  like: '/img/linkedIn_icons/like.png',
  comment: '/img/linkedIn_icons/comment.png',
  repost: '/img/linkedIn_icons/repost.png',
  share: '/img/linkedIn_icons/share.png',
}
const TEMPLATE_X_ICONS = {
  comment: '/img/x_icons/comment.png',
  repost: '/img/x_icons/repost.png',
  like: '/img/x_icons/like.png',
  views: '/img/x_icons/views.png',
  grok: '/img/x_icons/grok.png',
}
const TEMPLATE_TT_ICONS = {
  like: '/img/tiktok_icons/like.png',
  comment: '/img/tiktok_icons/comment.png',
  save: '/img/tiktok_icons/save.png',
  share: '/img/tiktok_icons/share.png',
  plus: '/img/tiktok_icons/plus.png',
}

const COUNTRIES = [
  ['AF','Afghanistan'],
  ['AX','Aland Islands'],
  ['AL','Albania'],
  ['DZ','Algeria'],
  ['AS','American Samoa'],
  ['AD','Andorra'],
  ['AO','Angola'],
  ['AI','Anguilla'],
  ['AQ','Antarctica'],
  ['AG','Antigua & Barbuda'],
  ['AR','Argentina'],
  ['AM','Armenia'],
  ['AW','Aruba'],
  ['AU','Australia'],
  ['AT','Austria'],
  ['AZ','Azerbaijan'],
  ['BS','Bahamas'],
  ['BH','Bahrain'],
  ['BD','Bangladesh'],
  ['BB','Barbados'],
  ['BY','Belarus'],
  ['BE','Belgium'],
  ['BZ','Belize'],
  ['BJ','Benin'],
  ['BM','Bermuda'],
  ['BT','Bhutan'],
  ['BO','Bolivia'],
  ['BA','Bosnia & Herzegovina'],
  ['BW','Botswana'],
  ['BV','Bouvet Island'],
  ['BR','Brazil'],
  ['IO','British Indian Ocean Territory'],
  ['VG','British Virgin Islands'],
  ['BN','Brunei'],
  ['BG','Bulgaria'],
  ['BF','Burkina Faso'],
  ['BI','Burundi'],
  ['KH','Cambodia'],
  ['CM','Cameroon'],
  ['CA','Canada'],
  ['CV','Cape Verde'],
  ['BQ','Caribbean Netherlands'],
  ['KY','Cayman Islands'],
  ['CF','Central African Republic'],
  ['TD','Chad'],
  ['CL','Chile'],
  ['CN','China'],
  ['CX','Christmas Island'],
  ['CC','Cocos (Keeling) Islands'],
  ['CO','Colombia'],
  ['KM','Comoros'],
  ['CG','Congo - Brazzaville'],
  ['CD','Congo - Kinshasa'],
  ['CK','Cook Islands'],
  ['CR','Costa Rica'],
  ['CI','Cote d\'Ivoire'],
  ['HR','Croatia'],
  ['CU','Cuba'],
  ['CW','Curacao'],
  ['CY','Cyprus'],
  ['CZ','Czechia'],
  ['DK','Denmark'],
  ['DJ','Djibouti'],
  ['DM','Dominica'],
  ['DO','Dominican Republic'],
  ['EC','Ecuador'],
  ['EG','Egypt'],
  ['SV','El Salvador'],
  ['GQ','Equatorial Guinea'],
  ['ER','Eritrea'],
  ['EE','Estonia'],
  ['SZ','Eswatini'],
  ['ET','Ethiopia'],
  ['FK','Falkland Islands'],
  ['FO','Faroe Islands'],
  ['FJ','Fiji'],
  ['FI','Finland'],
  ['FR','France'],
  ['GF','French Guiana'],
  ['PF','French Polynesia'],
  ['TF','French Southern Territories'],
  ['GA','Gabon'],
  ['GM','Gambia'],
  ['GE','Georgia'],
  ['DE','Germany'],
  ['GH','Ghana'],
  ['GI','Gibraltar'],
  ['GR','Greece'],
  ['GL','Greenland'],
  ['GD','Grenada'],
  ['GP','Guadeloupe'],
  ['GU','Guam'],
  ['GT','Guatemala'],
  ['GG','Guernsey'],
  ['GN','Guinea'],
  ['GW','Guinea-Bissau'],
  ['GY','Guyana'],
  ['HT','Haiti'],
  ['HM','Heard & McDonald Islands'],
  ['HN','Honduras'],
  ['HK','Hong Kong SAR China'],
  ['HU','Hungary'],
  ['IS','Iceland'],
  ['IN','India'],
  ['ID','Indonesia'],
  ['IR','Iran'],
  ['IQ','Iraq'],
  ['IE','Ireland'],
  ['IM','Isle of Man'],
  ['IL','Israel'],
  ['IT','Italy'],
  ['JM','Jamaica'],
  ['JP','Japan'],
  ['JE','Jersey'],
  ['JO','Jordan'],
  ['KZ','Kazakhstan'],
  ['KE','Kenya'],
  ['KI','Kiribati'],
  ['KW','Kuwait'],
  ['KG','Kyrgyzstan'],
  ['LA','Laos'],
  ['LV','Latvia'],
  ['LB','Lebanon'],
  ['LS','Lesotho'],
  ['LR','Liberia'],
  ['LY','Libya'],
  ['LI','Liechtenstein'],
  ['LT','Lithuania'],
  ['LU','Luxembourg'],
  ['MO','Macao SAR China'],
  ['MG','Madagascar'],
  ['MW','Malawi'],
  ['MY','Malaysia'],
  ['MV','Maldives'],
  ['ML','Mali'],
  ['MT','Malta'],
  ['MH','Marshall Islands'],
  ['MQ','Martinique'],
  ['MR','Mauritania'],
  ['MU','Mauritius'],
  ['YT','Mayotte'],
  ['MX','Mexico'],
  ['FM','Micronesia'],
  ['MD','Moldova'],
  ['MC','Monaco'],
  ['MN','Mongolia'],
  ['ME','Montenegro'],
  ['MS','Montserrat'],
  ['MA','Morocco'],
  ['MZ','Mozambique'],
  ['MM','Myanmar (Burma)'],
  ['NA','Namibia'],
  ['NR','Nauru'],
  ['NP','Nepal'],
  ['NL','Netherlands'],
  ['NC','New Caledonia'],
  ['NZ','New Zealand'],
  ['NI','Nicaragua'],
  ['NE','Niger'],
  ['NG','Nigeria'],
  ['NU','Niue'],
  ['NF','Norfolk Island'],
  ['KP','North Korea'],
  ['MK','North Macedonia'],
  ['MP','Northern Mariana Islands'],
  ['NO','Norway'],
  ['OM','Oman'],
  ['PK','Pakistan'],
  ['PW','Palau'],
  ['PS','Palestinian Territories'],
  ['PA','Panama'],
  ['PG','Papua New Guinea'],
  ['PY','Paraguay'],
  ['PE','Peru'],
  ['PH','Philippines'],
  ['PN','Pitcairn Islands'],
  ['PL','Poland'],
  ['PT','Portugal'],
  ['PR','Puerto Rico'],
  ['QA','Qatar'],
  ['RE','Reunion'],
  ['RO','Romania'],
  ['RU','Russia'],
  ['RW','Rwanda'],
  ['WS','Samoa'],
  ['SM','San Marino'],
  ['ST','Sao Tome & Principe'],
  ['SA','Saudi Arabia'],
  ['SN','Senegal'],
  ['RS','Serbia'],
  ['SC','Seychelles'],
  ['SL','Sierra Leone'],
  ['SG','Singapore'],
  ['SX','Sint Maarten'],
  ['SK','Slovakia'],
  ['SI','Slovenia'],
  ['SB','Solomon Islands'],
  ['SO','Somalia'],
  ['ZA','South Africa'],
  ['GS','South Georgia & South Sandwich Islands'],
  ['KR','South Korea'],
  ['SS','South Sudan'],
  ['ES','Spain'],
  ['LK','Sri Lanka'],
  ['BL','St. Barthelemy'],
  ['SH','St. Helena'],
  ['KN','St. Kitts & Nevis'],
  ['LC','St. Lucia'],
  ['MF','St. Martin'],
  ['PM','St. Pierre & Miquelon'],
  ['VC','St. Vincent & Grenadines'],
  ['SD','Sudan'],
  ['SR','Suriname'],
  ['SJ','Svalbard & Jan Mayen'],
  ['SE','Sweden'],
  ['CH','Switzerland'],
  ['SY','Syria'],
  ['TW','Taiwan'],
  ['TJ','Tajikistan'],
  ['TZ','Tanzania'],
  ['TH','Thailand'],
  ['TL','Timor-Leste'],
  ['TG','Togo'],
  ['TK','Tokelau'],
  ['TO','Tonga'],
  ['TT','Trinidad & Tobago'],
  ['TN','Tunisia'],
  ['TR','Turkiye'],
  ['TM','Turkmenistan'],
  ['TC','Turks & Caicos Islands'],
  ['TV','Tuvalu'],
  ['UM','U.S. Outlying Islands'],
  ['VI','U.S. Virgin Islands'],
  ['UG','Uganda'],
  ['UA','Ukraine'],
  ['AE','United Arab Emirates'],
  ['GB','United Kingdom'],
  ['US','United States'],
  ['UY','Uruguay'],
  ['UZ','Uzbekistan'],
  ['VU','Vanuatu'],
  ['VA','Vatican City'],
  ['VE','Venezuela'],
  ['VN','Vietnam'],
  ['WF','Wallis & Futuna'],
  ['EH','Western Sahara'],
  ['YE','Yemen'],
  ['ZM','Zambia'],
  ['ZW','Zimbabwe'],
]

const COUNTRY_NAME_BY_CODE = Object.fromEntries(COUNTRIES)
const ALL_COUNTRY_CODES = COUNTRIES.map(([code]) => code)
const NEW_POST_DRAFT_KEY = 'agentmarket:new-post:draft:v1'

function resolveTargetCountries(targeting = {}) {
  const include = Array.isArray(targeting.countries) ? targeting.countries.filter(Boolean) : []
  if (include.length > 0) return Array.from(new Set(include))

  // Backward compatibility: migrate legacy exclude-mode targeting into a countries list.
  if (targeting.mode === 'exclude' && Array.isArray(targeting.excluded_countries)) {
    const excluded = new Set(targeting.excluded_countries.filter(Boolean))
    return ALL_COUNTRY_CODES.filter(code => !excluded.has(code))
  }

  return []
}

function normalizeMediaUrl(rawUrl) {
  if (!rawUrl) return ''
  if (rawUrl.startsWith('data:')) return rawUrl

  const publicApi = process.env.NEXT_PUBLIC_API_URL || ''
  if (rawUrl.startsWith('/')) return publicApi ? `${publicApi}${rawUrl}` : rawUrl

  try {
    const parsed = new URL(rawUrl)
    if (publicApi && ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)) {
      const apiBase = new URL(publicApi)
      return `${apiBase.origin}${parsed.pathname}${parsed.search}`
    }
    return rawUrl
  } catch {
    if (publicApi) return `${publicApi}/${rawUrl.replace(/^\/+/, '')}`
    return rawUrl
  }
}

function isNgrokHost(hostname = '') {
  const host = hostname.toLowerCase()
  return host.endsWith('ngrok-free.dev') || host.endsWith('ngrok.io') || host.endsWith('ngrok.app')
}

function toPreviewSrc(url) {
  if (!url || url.startsWith('data:')) return url
  try {
    const parsed = new URL(url)
    if (isNgrokHost(parsed.hostname)) {
      return `/api/media-proxy?url=${encodeURIComponent(url)}`
    }
    return url
  } catch {
    return url
  }
}

function getMediaPreviewUrl(item) {
  if (!item) return ''
  const conversionUrl = (item.conversions || []).find(c => c?.url)?.url
  const pathUrl = item.path ? `/uploads/${item.path}` : ''
  const resolved = normalizeMediaUrl(item.url || item.preview || item.thumb || item.download_url || conversionUrl || pathUrl || '')
  return toPreviewSrc(resolved)
}

function isVideoItem(item) {
  const mime = (item?.mime_type || '').toLowerCase()
  if (mime.startsWith('video/')) return true
  const candidate = `${item?.url || item?.preview || ''}`
  return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(candidate)
}

function isCoverMediaItem(item) {
  return item?.role === 'thumbnail'
}

function isPrimaryVideoItem(item) {
  return isVideoItem(item) && !isCoverMediaItem(item)
}

function isPrimaryImageItem(item) {
  if (!item || isCoverMediaItem(item) || isVideoItem(item)) return false
  const mime = (item?.mime_type || '').toLowerCase()
  return !mime || mime.startsWith('image')
}

function resolveEditorMediaSlots(items) {
  const list = items || []
  const video = list.find(isPrimaryVideoItem)
  const explicitCover = list.find(isCoverMediaItem)
  const images = list.filter(isPrimaryImageItem)

  let cover = explicitCover
  let unattachedImages = images

  if (video && !explicitCover && images.length === 1) {
    cover = { ...images[0], role: 'thumbnail' }
    unattachedImages = []
  } else if (video && explicitCover) {
    unattachedImages = images.filter(img => img !== explicitCover)
  }

  const image = !video ? images[0] : null
  const kind = video ? 'video' : image ? 'image' : 'empty'
  const display = kind === 'video' ? [video, cover].filter(Boolean) : image ? [image] : []
  const legacyExtraImages = video ? unattachedImages : unattachedImages.slice(image ? 1 : 0)

  return { kind, video, cover, image, display, legacyExtraImages }
}

function getPlatformWarnings(provider, mediaItems, charCount, charLimit, isStory) {
  const warnings = []
  const info = PLATFORM_INFO[provider]
  if (!info) return warnings
  const hasMedia = mediaItems.length > 0
  const videoItems = mediaItems.filter(isPrimaryVideoItem)
  const imageItems = mediaItems.filter(isPrimaryImageItem)
  const hasVideo = videoItems.length > 0
  const hasImage = imageItems.length > 0

  // ── Instagram / Instagram Login ──────────────────────────────────────────
  if (INSTAGRAM_PROVIDERS.includes(provider)) {
    if (!hasMedia) {
      warnings.push({ level: 'error', msg: 'Requires at least one image or video' })
    } else {
      imageItems.forEach(m => {
        const mime = String(m.mime_type || '').toLowerCase()
        if (mime === 'image/png')
          warnings.push({ level: 'warning', msg: `"${m.name || 'Image'}" will be converted to JPEG for Instagram` })
        else if (mime && !['image/jpeg', 'image/jpg'].includes(mime))
          warnings.push({ level: 'error', msg: `"${m.name || 'Image'}" must be JPEG or PNG (not ${m.mime_type})` })
        if (m.size && m.size > 8 * 1024 * 1024)
          warnings.push({ level: 'error', msg: `"${m.name || 'Image'}" exceeds 8 MB limit` })
        if (m.width && m.height) {
          const ratio = m.width / m.height
          if (ratio < 0.8 || ratio > 1.91)
            warnings.push({ level: 'error', msg: `Aspect ratio ${ratio.toFixed(2)}:1 out of range (must be 4:5 to 1.91:1)` })
          if (m.width < 320) warnings.push({ level: 'warning', msg: `Image too small — min 320 px width` })
        }
      })

      videoItems.forEach(m => {
        if (m.size && m.size > 650 * 1024 * 1024)
          warnings.push({ level: 'error', msg: `Video exceeds 650 MB` })
        if (m.duration && m.duration > 900)
          warnings.push({ level: 'error', msg: `Video too long — Instagram max 15 minutes` })
      })

      if (mediaItems.length > 10) warnings.push({ level: 'error', msg: 'Carousel limit is 10 items' })
      if (isStory && mediaItems.length > 1) warnings.push({ level: 'warning', msg: 'Stories support only 1 media item' })
    }
  }

  // ── TikTok ───────────────────────────────────────────────────────────────
  if (provider === 'tiktok') {
    if (!hasMedia) {
      warnings.push({ level: 'error', msg: 'TikTok requires a video (MP4 or MOV)' })
    } else if (!hasVideo) {
      warnings.push({ level: 'error', msg: 'TikTok does not support images — upload a video (MP4 or MOV)' })
    } else {
      if (hasImage) warnings.push({ level: 'warning', msg: 'Remove images — TikTok accepts video only' })
      const vid = videoItems[0]
      if (vid?.duration && vid.duration < 3) warnings.push({ level: 'error', msg: 'Video must be at least 3 seconds' })
      if (vid?.duration && vid.duration > 600) warnings.push({ level: 'warning', msg: 'Video over 10 min — verify your account has long-video access' })
      if (vid?.size && vid.size > 4 * 1024 * 1024 * 1024) warnings.push({ level: 'error', msg: 'Video exceeds 4 GB limit' })
    }
  }

  // ── Twitter / X ──────────────────────────────────────────────────────────
  if (provider === 'twitter') {
    if (hasVideo && hasImage) warnings.push({ level: 'error', msg: 'X does not allow mixing images and video in one post' })
    else if (hasVideo && videoItems.length > 1) warnings.push({ level: 'error', msg: 'X supports only 1 video per post' })
    else if (!hasVideo && imageItems.length > 4) warnings.push({ level: 'error', msg: 'X supports max 4 images per post' })
    imageItems.forEach(m => {
      if (m.size && m.size > 5 * 1024 * 1024) warnings.push({ level: 'warning', msg: `"${m.name || 'Image'}" exceeds 5 MB — animated GIF max 15 MB` })
    })
    const vid = videoItems[0]
    if (vid) {
      if (vid.size && vid.size > 512 * 1024 * 1024) warnings.push({ level: 'error', msg: 'Video exceeds 512 MB limit' })
      if (vid.duration && vid.duration > 140) warnings.push({ level: 'error', msg: 'Video must be ≤ 2m 20s (140 sec)' })
    }
  }

  // ── LinkedIn ─────────────────────────────────────────────────────────────
  if (provider === 'linkedin') {
    if (hasVideo && hasImage) warnings.push({ level: 'error', msg: 'LinkedIn does not allow mixing images and video' })
    else if (!hasVideo && imageItems.length > 9) warnings.push({ level: 'error', msg: 'LinkedIn supports max 9 images per post' })
    const vid = videoItems[0]
    if (vid) {
      if (vid.size && vid.size > 5 * 1024 * 1024 * 1024) warnings.push({ level: 'error', msg: 'Video exceeds 5 GB limit' })
      if (vid.duration && vid.duration > 900) warnings.push({ level: 'error', msg: 'Video must be ≤ 15 minutes' })
      if (vid.duration && vid.duration < 3) warnings.push({ level: 'error', msg: 'Video must be at least 3 seconds' })
    }
  }

  // ── Facebook ─────────────────────────────────────────────────────────────
  if (provider === 'facebook') {
    imageItems.forEach(m => {
      if (m.size && m.size > 4 * 1024 * 1024) warnings.push({ level: 'warning', msg: `"${m.name || 'Image'}" exceeds 4 MB` })
    })
    const vid = videoItems[0]
    if (vid) {
      if (vid.size && vid.size > 4 * 1024 * 1024 * 1024) warnings.push({ level: 'error', msg: 'Video exceeds 4 GB limit' })
      if (vid.duration && vid.duration > 14400) warnings.push({ level: 'error', msg: 'Video must be ≤ 240 minutes' })
    }
  }

  // ── Character count ──────────────────────────────────────────────────────
  if (charCount > charLimit) warnings.push({ level: 'error', msg: `Text too long (${charCount}/${charLimit})` })
  else if (charCount > charLimit * 0.9) warnings.push({ level: 'warning', msg: `Approaching limit (${charCount}/${charLimit})` })

  return warnings
}

export default function PostEditor({ postId, embedded = false, onDone }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const { confirm, ConfirmDialogHost } = useConfirmDialog()
  const { settings, formatDateTime, isoToDatetimeLocalValue, datetimeLocalValueToIso } = useWorkspaceSettings()
  const isEdit = !!postId

  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [accounts, setAccounts] = useState([])
  const [selectedAccounts, setSelectedAccounts] = useState([])
  const [versions, setVersions] = useState([{ account_id: null, is_original: true, content: [{ type: 'text', body: '' }] }])
  const [activeVersion, setActiveVersion] = useState(null)
  const [scheduledAt, setScheduledAt] = useState('')
  const [isStory, setIsStory] = useState(false)
  const [mediaPickerTarget, setMediaPickerTarget] = useState(null)
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [showTargeting, setShowTargeting] = useState(false)
  const [showFirstComment, setShowFirstComment] = useState(false)
  const [rightTab, setRightTab] = useState('text')
  const [generatingImage, setGeneratingImage] = useState(false)
  const [showCountryPicker, setShowCountryPicker] = useState(false)
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [igCarouselIndex, setIgCarouselIndex] = useState(0)
  const [countryQuery, setCountryQuery] = useState('')
  const [failedPreviews, setFailedPreviews] = useState({})
  const [draftHydrated, setDraftHydrated] = useState(isEdit)
  const [mediaIntent, setMediaIntent] = useState(null)
  const [postStatus, setPostStatus] = useState(0)
  const [scheduleStatus, setScheduleStatus] = useState(0)

  useEffect(() => {
    const init = async () => {
      try {
        const baseData = isEdit ? await api.post(postId) : null
        const accs = await api.accounts({ kind: 'social' })
        setAccounts(accs || [])

        if (baseData?.post) {
          const p = baseData.post
          setPostStatus(typeof p.status === 'number' ? p.status : 0)
          setScheduleStatus(typeof p.schedule_status === 'number' ? p.schedule_status : 0)
          setSelectedAccounts(p.account_ids || [])
          setVersions(p.versions?.length ? p.versions : [{ account_id: null, is_original: true, content: [{ type: 'text', body: '' }] }])
          setScheduledAt(p.scheduled_at ? isoToDatetimeLocalValue(p.scheduled_at) : '')
          const orig = p.versions?.find(v => v.is_original) || p.versions?.[0]
          if (orig?.content?.find(b => b.type === 'link')?.url) setShowLinkInput(true)
          if (orig?.targeting?.mode || orig?.targeting?.countries?.length || orig?.targeting?.excluded_countries?.length || orig?.targeting?.age_min) setShowTargeting(true)
          if (orig?.first_comment) setShowFirstComment(true)
          if (orig?.is_story) setIsStory(true)
          const allMedia = (p.versions || []).flatMap(v => (v.content || []).find(b => b.type === 'media')?.media || [])
          if (allMedia.some(m => isPrimaryVideoItem(m) || (isVideoItem(m) && !isCoverMediaItem(m)))) setMediaIntent('video')
          else if (allMedia.some(isPrimaryImageItem)) setMediaIntent('image')
        } else {
          let nextScheduledAt = ''
          try {
            const raw = localStorage.getItem(NEW_POST_DRAFT_KEY)
            if (raw) {
              const draft = JSON.parse(raw)
              if (Array.isArray(draft.selectedAccounts)) setSelectedAccounts(draft.selectedAccounts)
              else if (settings.default_accounts?.length) setSelectedAccounts(settings.default_accounts)
              if (Array.isArray(draft.versions) && draft.versions.length) setVersions(draft.versions)
              if (draft.activeVersion === null || typeof draft.activeVersion === 'string') setActiveVersion(draft.activeVersion)
              if (typeof draft.scheduledAt === 'string') nextScheduledAt = draft.scheduledAt
              if (typeof draft.isStory === 'boolean') setIsStory(draft.isStory)
              if (typeof draft.showLinkInput === 'boolean') setShowLinkInput(draft.showLinkInput)
              if (typeof draft.showTargeting === 'boolean') setShowTargeting(draft.showTargeting)
              if (typeof draft.showFirstComment === 'boolean') setShowFirstComment(draft.showFirstComment)
              if (typeof draft.rightTab === 'string') setRightTab(draft.rightTab)
              if (typeof draft.countryQuery === 'string') setCountryQuery(draft.countryQuery)
            } else if (settings.default_accounts?.length) {
              setSelectedAccounts(settings.default_accounts)
            }
          } catch (err) {
            console.warn('Failed to restore draft', err)
            if (settings.default_accounts?.length) setSelectedAccounts(settings.default_accounts)
          }
          if (!nextScheduledAt) {
            const dateParam = searchParams.get('date')
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam || '')) {
              nextScheduledAt = `${dateParam}T09:00`
            }
          }
          setScheduledAt(nextScheduledAt)
        }
      } finally {
        setLoading(false)
        setDraftHydrated(true)
      }
    }
    init().catch(console.error)
  }, [postId, settings.default_accounts, isoToDatetimeLocalValue, searchParams])

  useEffect(() => {
    if (isEdit || !draftHydrated) return
    const payload = {
      selectedAccounts,
      versions,
      activeVersion,
      scheduledAt,
      isStory,
      showLinkInput,
      showTargeting,
      showFirstComment,
      rightTab,
      countryQuery,
    }
    try {
      localStorage.setItem(NEW_POST_DRAFT_KEY, JSON.stringify(payload))
    } catch {}
  }, [
    isEdit,
    draftHydrated,
    selectedAccounts,
    versions,
    activeVersion,
    scheduledAt,
    isStory,
    showLinkInput,
    showTargeting,
    showFirstComment,
    rightTab,
    countryQuery,
  ])

  useEffect(() => {
    if (selectedAccounts.length === 0) {
      setPreviewIndex(0)
      setShowPreviewModal(false)
      return
    }
    setPreviewIndex(i => Math.min(i, selectedAccounts.length - 1))
  }, [selectedAccounts.length])

  const currentVersion = () => {
    if (activeVersion === null) return versions.find(v => v.is_original) || versions[0]
    return versions.find(v => v.account_id === activeVersion) || versions.find(v => v.is_original) || versions[0]
  }

  const updateVersion = (updater) => {
    setVersions(vs => vs.map(v => {
      const isTarget = activeVersion === null ? v.is_original : v.account_id === activeVersion
      return isTarget ? updater(v) : v
    }))
  }

  const updateContent = (body) => {
    updateVersion(v => {
      const content = v.content.map(b => b.type === 'text' ? { ...b, body } : b)
      return { ...v, content: content.length ? content : [{ type: 'text', body }] }
    })
  }

  const updateLink = (url) => {
    updateVersion(v => {
      const hasLink = v.content.find(b => b.type === 'link')
      if (hasLink) return { ...v, content: v.content.map(b => b.type === 'link' ? { ...b, url } : b) }
      return { ...v, content: [...v.content, { type: 'link', url }] }
    })
  }

  const removeLink = () => {
    updateVersion(v => ({ ...v, content: v.content.filter(b => b.type !== 'link') }))
    setShowLinkInput(false)
  }

  const replaceVersionMedia = (nextMedia) => {
    updateVersion(v => {
      const without = v.content.filter(b => b.type !== 'media')
      if (!nextMedia.length) return { ...v, content: without }
      return { ...v, content: [...without, { type: 'media', media: nextMedia }] }
    })
  }

  const handleMediaPickerSelect = (items) => {
    const target = mediaPickerTarget
    if (!target) return

    const allowed = items.filter(item => {
      const mime = String(item.mime_type || '').toLowerCase()
      if (target === 'video') return mime.startsWith('video')
      return !mime || mime.startsWith('image')
    })
    if (!allowed.length) {
      toast.error(target === 'video' ? 'Select a video file' : 'Select an image file')
      return
    }

    const cvNow = currentVersion()
    const current = cvNow?.content?.find(b => b.type === 'media')?.media || []
    const { video, cover } = resolveEditorMediaSlots(current)

    if (target === 'video') {
      const nextVideo = allowed[0]
      replaceVersionMedia(cover ? [nextVideo, cover] : [nextVideo])
      setMediaIntent('video')
    } else if (target === 'cover') {
      if (!video) {
        toast.error('Add a video first')
        return
      }
      replaceVersionMedia([video, { ...allowed[0], role: 'thumbnail' }])
    } else {
      replaceVersionMedia([allowed[0]])
      setMediaIntent('image')
    }
    setMediaPickerTarget(null)
  }

  const removeMediaItem = (item) => {
    updateVersion(v => {
      const block = v.content.find(b => b.type === 'media')
      if (!block) return v
      let media = block.media.filter(m => m !== item)
      if (isPrimaryVideoItem(item)) {
        media = media.filter(m => !isCoverMediaItem(m) && !isPrimaryImageItem(m))
      }
      const without = v.content.filter(b => b.type !== 'media')
      return media.length
        ? { ...v, content: [...without, { ...block, media }] }
        : { ...v, content: without }
    })
  }

  const markPreviewFailed = (mediaKey) => {
    if (!mediaKey) return
    setFailedPreviews(prev => (prev[mediaKey] ? prev : { ...prev, [mediaKey]: true }))
  }

  const generateImageFromText = async () => {
    const prompt = (currentVersion()?.content?.find(b => b.type === 'text')?.body || '').trim()
    if (!prompt || generatingImage) return

    setGeneratingImage(true)
    try {
      const ai = await api.aiGenerateImage({ prompt, purpose: 'social_post', style: 'marketing' })
      if (!ai?.image) throw new Error('No image returned from AI')

      const blob = await fetch(ai.image).then(r => r.blob())
      const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/gif' ? 'gif' : 'png'
      const file = new File([blob], `ai-generated-${Date.now()}.${ext}`, { type: blob.type || 'image/png' })
      const uploaded = await api.uploadMedia(file)

      replaceVersionMedia([uploaded])
      setMediaIntent('image')
      toast.success('AI image generated and added to media')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setGeneratingImage(false)
    }
  }

  const updateTargeting = (field, value) => {
    updateVersion(v => ({ ...v, targeting: { ...(v.targeting || {}), [field]: value } }))
  }

  const setSelectedCountries = (countries) => {
    const unique = Array.from(new Set(countries))
    updateVersion(v => {
      const nextTargeting = { ...(v.targeting || {}), countries: unique }
      delete nextTargeting.mode
      delete nextTargeting.excluded_countries
      return { ...v, targeting: nextTargeting }
    })
  }

  const selectAllCountries = () => setSelectedCountries(ALL_COUNTRY_CODES)
  const clearAllCountries = () => setSelectedCountries([])

  const toggleCountry = (code) => {
    const current = resolveTargetCountries(currentVersion()?.targeting || {})
    setSelectedCountries(current.includes(code) ? current.filter(c => c !== code) : [...current, code])
  }

  const resolveVideoPost = () => {
    const cv = currentVersion()
    const items = cv?.content?.find(b => b.type === 'media')?.media || []
    const { kind } = resolveEditorMediaSlots(items)
    return kind === 'video' || mediaIntent === 'video'
  }

  useEffect(() => {
    if (!accounts.length) return
    const videoPost = resolveVideoPost()
    if (videoPost) return
    setSelectedAccounts(prev => {
      const next = filterSelectableAccountIds(prev, accounts, { videoPost })
      return next.length === prev.length ? prev : next
    })
  }, [accounts, versions, mediaIntent, activeVersion])

  const toggleAccount = (id) => {
    const acc = accounts.find(a => a.id === id)
    if (!canSelectAccountForPost(acc, { videoPost: resolveVideoPost() })) return
    setSelectedAccounts(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  }

  const updateFirstComment = (body) => updateVersion(v => ({ ...v, first_comment: body || undefined }))

  const charCount = () => (currentVersion()?.content?.find(b => b.type === 'text')?.body || '').length

  const getLimit = () => {
    if (activeVersion && selectedAccounts.includes(activeVersion)) {
      const acc = accounts.find(a => a.id === activeVersion)
      return acc ? (PROVIDER_LIMITS[acc.provider] || 5000) : 5000
    }
    if (!selectedAccounts.length) return 5000
    return Math.min(...selectedAccounts.map(id => {
      const acc = accounts.find(a => a.id === id)
      return acc ? (PROVIDER_LIMITS[acc.provider] || 5000) : 5000
    }))
  }

  const getVersionForAccount = (accountId) => {
    return versions.find(v => v.account_id === accountId)
      || versions.find(v => v.is_original)
      || versions[0]
      || { content: [{ type: 'text', body: '' }] }
  }

  const buildVersionsForSave = () => versions.map(v => {
    const acc = v.account_id ? accounts.find(a => a.id === v.account_id) : null
    const isInstagram = acc ? INSTAGRAM_PROVIDERS.includes(acc.provider) : (isStory && hasInstagramAccount && v.is_original)

    const normalizedTargeting = v.targeting
      ? { ...v.targeting, countries: resolveTargetCountries(v.targeting) }
      : undefined
    if (normalizedTargeting) {
      delete normalizedTargeting.mode
      delete normalizedTargeting.excluded_countries
    }

    const mediaBlock = v.content?.find(b => b.type === 'media')
    let content = v.content
    if (mediaBlock) {
      const { video, cover, image } = resolveEditorMediaSlots(mediaBlock.media || [])
      const normalizedMedia = video
        ? [video, ...(cover ? [{ ...cover, role: 'thumbnail' }] : [])]
        : image ? [image] : []
      content = [
        ...v.content.filter(b => b.type !== 'media'),
        ...(normalizedMedia.length ? [{ type: 'media', media: normalizedMedia }] : []),
      ]
    }

    const next = { ...v, content, ...(normalizedTargeting ? { targeting: normalizedTargeting } : {}) }
    return isStory && isInstagram ? { ...next, is_story: true } : { ...next, is_story: undefined }
  })

  const save = async (scheduleNow = false) => {
    if (saving) return
    const textBody = currentVersion()?.content?.find(b => b.type === 'text')?.body?.trim()
    if (!textBody) { toast.error('Post content cannot be empty'); return }
    const publishAccountIds = filterSelectableAccountIds(selectedAccounts, accounts, { videoPost: resolveVideoPost() })
    if (scheduleNow && !publishAccountIds.length) { toast.error('Select at least one account'); return }
    setSaving(true)
    try {
      const immediatePublish = scheduleNow && !scheduledAt
      const scheduleTime = scheduledAt
        ? datetimeLocalValueToIso(scheduledAt)
        : (scheduleNow && !immediatePublish ? new Date(Date.now() + 5000).toISOString() : null)
      const payload = { account_ids: publishAccountIds, versions: buildVersionsForSave() }
      if (isEdit) {
        if (immediatePublish && (postStatus === 2 || postStatus === 3 || scheduleStatus === 1)) {
          payload.status = 0
          payload.schedule_status = 0
        }
        await api.updatePost(postId, payload)
        if (scheduleNow) {
          if (immediatePublish) {
            const pub = await api.publishPost(postId, { account_ids: publishAccountIds })
            toast.success(pub.queued ? 'Post queued for publishing' : 'Post published')
          } else {
            await api.schedulePost(postId, { scheduled_at: scheduleTime, account_ids: publishAccountIds })
            toast.success('Post queued')
          }
          if (embedded && onDone) onDone()
          else router.push('/posts')
          return
        }
        toast.success('Post updated')
        if (embedded && onDone) onDone()
      } else {
        const post = await api.createPost(payload)
        try { localStorage.removeItem(NEW_POST_DRAFT_KEY) } catch {}
        if (scheduleNow) {
          try {
            if (immediatePublish) {
              const pub = await api.publishPost(post.id, { account_ids: publishAccountIds })
              toast.success(pub.queued ? 'Post queued for publishing' : 'Post published')
            } else {
              await api.schedulePost(post.id, { scheduled_at: scheduleTime, account_ids: publishAccountIds })
              toast.success('Post scheduled')
            }
          } catch (e) { toast.error(e.message) }
        } else {
          toast.success('Draft saved')
        }
        if (embedded && onDone) onDone(post)
        else router.push('/posts')
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const del = async () => {
    const ok = await confirm({
      title: 'Delete post?',
      message: 'Delete this post? This cannot be undone.',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try { await api.deletePost(postId); toast.success('Deleted'); router.push('/posts') }
    catch (err) { toast.error(err.message) }
  }

  if (loading) return <div className="skeleton" style={{ height: embedded ? '100%' : 'calc(100vh - 80px)', borderRadius: 20 }} />

  const count = charCount()
  const limit = getLimit()
  const cv = currentVersion()
  const linkUrl = cv?.content?.find(b => b.type === 'link')?.url || ''
  const mediaItems = cv?.content?.find(b => b.type === 'media')?.media || []
  const { kind: editMediaKind, video: editorVideo, cover: editorCover, display: displayMedia, legacyExtraImages } = resolveEditorMediaSlots(mediaItems)
  const shownMedia = [...displayMedia, ...legacyExtraImages]
  const showMediaEmpty = mediaItems.length === 0
  const panelMedia = shownMedia.length > 0 ? shownMedia : mediaItems
  const emptyMediaIntent = mediaIntent || (editMediaKind === 'video' ? 'video' : editMediaKind === 'image' ? 'image' : null)
  const isVideoPost = editMediaKind === 'video' || emptyMediaIntent === 'video'
  const hasVideoMedia = !!editorVideo || panelMedia.some(m => isPrimaryVideoItem(m) || (isVideoItem(m) && !isCoverMediaItem(m)))
  const targeting = cv?.targeting || {}
  const selectedTargetCountries = resolveTargetCountries(targeting)
  const allCountriesSelected = selectedTargetCountries.length === ALL_COUNTRY_CODES.length
  const countryQueryText = countryQuery.trim().toLowerCase()
  const filteredCountries = COUNTRIES.filter(([code, name]) => {
    if (!countryQueryText) return true
    return code.toLowerCase().includes(countryQueryText) || name.toLowerCase().includes(countryQueryText)
  })
  const selectedCountryPreview = selectedTargetCountries
    .slice(0, 4)
    .map(code => COUNTRY_NAME_BY_CODE[code] || code)
    .join(', ')
  const firstComment = cv?.first_comment || ''
  const text = cv?.content?.find(b => b.type === 'text')?.body || ''
  const hasTextForAiImage = !!text.trim()

  const selectedAccountObjects = selectedAccounts.map(id => accounts.find(a => a.id === id)).filter(Boolean)
  const hasFacebookAccount    = selectedAccountObjects.some(a => a.provider === 'facebook')
  const hasInstagramAccount   = selectedAccountObjects.some(a => INSTAGRAM_PROVIDERS.includes(a.provider))
  const hasCommentableAccount = selectedAccountObjects.some(a => ['facebook', 'instagram', 'instagram_login'].includes(a.provider))
  const rightTabs = [
    { key: 'text', label: 'Text' },
    { key: 'accounts', label: `Accounts${selectedAccounts.length ? ` (${selectedAccounts.length})` : ''}` },
  ]
  const supportsStory         = hasInstagramAccount
  const activeVersionInfo     = activeVersion ? accounts.find(a => a.id === activeVersion) : null

  const accountWarnings = {}
  selectedAccountObjects.forEach(acc => {
    accountWarnings[acc.id] = getPlatformWarnings(acc.provider, mediaItems, count, PROVIDER_LIMITS[acc.provider] || 5000, isStory)
  })
  const totalErrors   = Object.values(accountWarnings).flat().filter(w => w.level === 'error').length
  const totalWarnings = Object.values(accountWarnings).flat().filter(w => w.level === 'warning').length

  const getPlaceholder = () => {
    if (selectedAccountObjects.some(a => a.provider === 'tiktok')) return 'Write a caption for your TikTok video...'
    if (hasInstagramAccount && !hasFacebookAccount) return 'Write a caption for Instagram...'
    if (selectedAccountObjects.some(a => a.provider === 'linkedin')) return 'Share something with your LinkedIn network...'
    return "What's on your mind?"
  }

  const previewItems = selectedAccountObjects.map(acc => {
    const version = getVersionForAccount(acc.id)
    return {
      accountId: acc.id,
      provider: acc.provider,
      accountName: acc.name,
      avatar: acc.media?.avatar || null,
      text: version?.content?.find(b => b.type === 'text')?.body || '',
      link: version?.content?.find(b => b.type === 'link')?.url || '',
      media: version?.content?.find(b => b.type === 'media')?.media || [],
      firstComment: version?.first_comment || '',
    }
  })

  const previewPosition = Math.min(previewIndex, Math.max(0, previewItems.length - 1))
  const activePreview = previewItems[previewPosition] || null

  const openPreview = () => {
    setPreviewIndex(0)
    setShowPreviewModal(true)
  }

  const goPrevPreview = () => {
    if (previewItems.length <= 1) return
    setPreviewIndex(i => (i - 1 + previewItems.length) % previewItems.length)
  }

  const goNextPreview = () => {
    if (previewItems.length <= 1) return
    setPreviewIndex(i => (i + 1) % previewItems.length)
  }

  const renderMediaFrame = (item, key, aspectRatio = '1 / 1', overlay = null, options = {}) => {
    const src = getMediaPreviewUrl(item)
    const video = isVideoItem(item)
    const borderRadius = options.borderRadius ?? 8
    const background = options.background || 'hsl(var(--surface-alt))'
    const fit = options.fit || 'cover'
    const border = options.border || 'none'
    const emptyLabel = options.emptyLabel || 'Media unavailable'

    return (
      <div key={key} style={{ position: 'relative', width: '100%', aspectRatio, borderRadius, overflow: 'hidden', background, border }}>
        {!src ? (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'hsl(var(--fg-muted))', fontSize: '0.78rem' }}>
            {emptyLabel}
          </div>
        ) : video ? (
          <video src={src} controls muted playsInline style={{ width: '100%', height: '100%', objectFit: fit }} />
        ) : (
          <img src={src} alt={item.name || 'media'} style={{ width: '100%', height: '100%', objectFit: fit }} />
        )}
        {overlay}
      </div>
    )
  }

  const renderOverlayCount = (count) => (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1.05rem' }}>
      +{count}
    </div>
  )

  const renderFacebookMedia = (items) => {
    const fbFrameOptions = { borderRadius: 0, background: '#0a0a0a', emptyLabel: 'No media attached' }



    if (items.length === 1) return renderMediaFrame(items[0], 'fb-0', '1 / 1', null, fbFrameOptions)
    if (items.length === 2) {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          {renderMediaFrame(items[0], 'fb-0', '1 / 1', null, fbFrameOptions)}
          {renderMediaFrame(items[1], 'fb-1', '1 / 1', null, fbFrameOptions)}
        </div>
      )
    }
    if (items.length === 3) {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 2 }}>
          <div style={{ gridRow: '1 / span 2' }}>{renderMediaFrame(items[0], 'fb-0', '1 / 1', null, fbFrameOptions)}</div>
          {renderMediaFrame(items[1], 'fb-1', '1 / 1', null, fbFrameOptions)}
          {renderMediaFrame(items[2], 'fb-2', '1 / 1', null, fbFrameOptions)}
        </div>
      )
    }
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        {renderMediaFrame(items[0], 'fb-0', '1 / 1', null, fbFrameOptions)}
        {renderMediaFrame(items[1], 'fb-1', '1 / 1', null, fbFrameOptions)}
        {renderMediaFrame(items[2], 'fb-2', '1 / 1', null, fbFrameOptions)}
        {renderMediaFrame(items[3], 'fb-3', '1 / 1', items.length > 4 ? renderOverlayCount(items.length - 4) : null, fbFrameOptions)}
      </div>
    )
  }

  const renderInstagramMedia = (items) => {
    const igFrameOptions = { borderRadius: 0, background: '#1a1a1a', border: 'none', emptyLabel: 'No media attached' }

    const withShell = (child) => (
      <div style={{ width: '100%', borderRadius: 4, overflow: 'hidden', border: '1px solid #262626', background: '#1a1a1a' }}>
        {child}
      </div>
    )


    if (items.length === 1) {
      return withShell(renderMediaFrame(items[0], 'ig-0', '1 / 1.05', null, igFrameOptions))
    }

    if (items.length === 2) {
      return withShell(
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          {renderMediaFrame(items[0], 'ig-0', '1 / 1', null, igFrameOptions)}
          {renderMediaFrame(items[1], 'ig-1', '1 / 1', null, igFrameOptions)}
        </div>
      )
    }

    if (items.length === 3) {
      return withShell(
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gridTemplateRows: '1fr 1fr', gap: 2, background: '#000' }}>
          <div style={{ gridColumn: '1', gridRow: '1' }}>{renderMediaFrame(items[0], 'ig-0', '1 / 1', null, igFrameOptions)}</div>
          <div style={{ gridColumn: '2', gridRow: '1' }}>{renderMediaFrame(items[1], 'ig-1', '1 / 1', null, igFrameOptions)}</div>
          <div style={{ gridColumn: '1 / -1', gridRow: '2' }}>{renderMediaFrame(items[2], 'ig-2', '2 / 1', null, igFrameOptions)}</div>
        </div>
      )
    }

    return withShell(
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        {renderMediaFrame(items[0], 'ig-0', '1 / 1', null, igFrameOptions)}
        {renderMediaFrame(items[1], 'ig-1', '1 / 1', null, igFrameOptions)}
        {renderMediaFrame(items[2], 'ig-2', '1 / 1', null, igFrameOptions)}
        {renderMediaFrame(items[3], 'ig-3', '1 / 1', items.length > 4 ? renderOverlayCount(items.length - 4) : null, igFrameOptions)}
      </div>
    )
  }

  const renderXMedia = (items) => {
    if (!items.length) return null
    if (items.length === 1) return renderMediaFrame(items[0], 'x-0', '16 / 9')
    if (items.length === 2) {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          {renderMediaFrame(items[0], 'x-0', '1 / 1')}
          {renderMediaFrame(items[1], 'x-1', '1 / 1')}
        </div>
      )
    }
    if (items.length === 3) {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 2 }}>
          <div style={{ gridColumn: '1 / span 2' }}>{renderMediaFrame(items[0], 'x-0', '16 / 9')}</div>
          {renderMediaFrame(items[1], 'x-1', '1 / 1')}
          {renderMediaFrame(items[2], 'x-2', '1 / 1')}
        </div>
      )
    }
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        {renderMediaFrame(items[0], 'x-0', '1 / 1')}
        {renderMediaFrame(items[1], 'x-1', '1 / 1')}
        {renderMediaFrame(items[2], 'x-2', '1 / 1')}
        {renderMediaFrame(items[3], 'x-3', '1 / 1', items.length > 4 ? renderOverlayCount(items.length - 4) : null)}
      </div>
    )
  }

  const renderLinkedInMedia = (items) => {
    if (!items.length) return null
    if (items.length === 1) return renderMediaFrame(items[0], 'li-0', '16 / 9')
    return renderFacebookMedia(items)
  }

  const renderTikTokMedia = (items) => {
    if (!items.length) {
      return (
        <div style={{ aspectRatio: '9 / 16', borderRadius: 8, background: 'linear-gradient(180deg,#111,#222)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: '0.82rem' }}>
          No media attached
        </div>
      )
    }

    return renderMediaFrame(items[0], 'tt-0', '9 / 16', items.length > 1 ? (
      <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 999, fontSize: '0.72rem', padding: '3px 8px', fontWeight: 600 }}>
        1 / {items.length}
      </div>
    ) : null)
  }

  const detectCaptionDirection = (value) => {
    const text = `${value || ''}`.trim()
    if (!text) return 'ltr'

    const firstStrong = text.match(/[A-Za-z\u00C0-\u024F\u0370-\u052F\u0590-\u08FF\u0900-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/)
    if (!firstStrong) return 'auto'

    return /[\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(firstStrong[0]) ? 'rtl' : 'ltr'
  }

  const captionHasMoreThanOneLine = (value, approxCharsPerLine = 64) => {
    const raw = `${value || ''}`
    if (!raw.trim()) return false
    if (raw.includes('\n')) return true
    const compact = raw.replace(/\s+/g, ' ').trim()
    return compact.length > approxCharsPerLine
  }

  const truncateCaptionToOneLine = (value, maxChars = 62) => {
    const compact = `${value || ''}`.replace(/\s+/g, ' ').trim()
    if (compact.length <= maxChars) return compact
    return compact.slice(0, maxChars).trimEnd()
  }

  const getCaptionFontFamily = (direction) => {
    if (direction === 'rtl') return "'Noto Naskh Arabic', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    return "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  }

  const renderPreviewByProvider = (preview) => {
    if (!preview) return null

    const caption = preview.text || 'Your caption will appear here.'
    const captionDirection = detectCaptionDirection(caption)
    const captionTextAlign = captionDirection === 'rtl' ? 'right' : 'left'
    const captionFontFamily = getCaptionFontFamily(captionDirection)
    const providerLabel = PLATFORM_INFO[preview.provider]?.label || preview.provider

    if (INSTAGRAM_PROVIDERS.includes(preview.provider)) {
      const username = (preview.accountName || 'account').replace(/\s+/g, '').toLowerCase()
      const showMore = captionHasMoreThanOneLine(caption, 52)
      const previewCaption = showMore ? truncateCaptionToOneLine(caption, 54) : caption
      const igMediaItems = preview.media || []
      const igHasMedia = igMediaItems.length > 0
      const currentMediaIdx = Math.min(igCarouselIndex, Math.max(0, igMediaItems.length - 1))

      return (
        <div style={{ background: '#000', borderRadius: 12, padding: '10px 8px', display: 'flex', justifyContent: 'center' }}>
          <article style={{ width: '100%', maxWidth: 470, background: '#1b1d21', overflow: 'hidden', borderRadius: 8, color: '#f5f5f5', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' }}>
            <header style={{ display: 'flex', alignItems: 'center', padding: '8px 4px 12px' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', padding: 2, background: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)', flexShrink: 0 }}>
                <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'linear-gradient(135deg, #2d5a3f, #1a3a2a)', border: '2px solid #000', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 11, overflow: 'hidden' }}>
                  {preview.avatar
                    ? <img src={preview.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} alt="" />
                    : (username.slice(0, 2) || 'IG').toUpperCase()
                  }
                </div>
              </div>

              <div style={{ marginLeft: 12, flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#f5f5f5' }}>{username || preview.accountName}</span>
                  <span style={{ color: '#a8a8a8', fontSize: 14 }}>•</span>
                  <span style={{ color: '#a8a8a8', fontSize: 14 }}>13h</span>
                </div>
                <div style={{ width: '100%', marginTop: 2 }}>
                  <span style={{ fontSize: 12, color: '#a8a8a8' }}>Suggested for you</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
                <button style={{ fontSize: 14, fontWeight: 600, color: '#0095f6', background: 'none', border: 'none', padding: 0, cursor: 'default' }}>Follow</button>
                <button style={{ background: 'none', border: 'none', color: '#f5f5f5', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default' }}>
                  <MoreHorizontal size={20} />
                </button>
              </div>
            </header>

            <div style={{ padding: '0 4px', position: 'relative' }}>
              {!igHasMedia ? (
                <div style={{ aspectRatio: '1 / 1.05', background: '#111', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16, textAlign: 'center' }}>
                  <AlertCircle size={28} color="#e1306c" strokeWidth={2} />
                  <span style={{ color: '#e1306c', fontWeight: 700, fontSize: '0.85rem' }}>Media required</span>
                  <span style={{ fontSize: '0.75rem', color: '#aaa', lineHeight: 1.4 }}>Instagram requires at least one image or video.<br/>JPEG images only, max 8 MB, ratio 4:5–1.91:1.</span>
                </div>
              ) : igMediaItems.length === 1 ? (
                renderMediaFrame(igMediaItems[0], 'ig-0', '1 / 1.05', null, { borderRadius: 0, background: '#1a1a1a', emptyLabel: 'No media' })
              ) : (
                <>
                  {renderMediaFrame(igMediaItems[currentMediaIdx], `ig-${currentMediaIdx}`, '1 / 1.05', null, { borderRadius: 0, background: '#1a1a1a', emptyLabel: 'No media' })}
                  <button
                    onClick={() => setIgCarouselIndex(i => (i - 1 + igMediaItems.length) % igMediaItems.length)}
                    style={{
                      position: 'absolute',
                      left: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'rgba(0,0,0,0.5)',
                      border: 'none',
                      color: '#fff',
                      cursor: 'pointer',
                      padding: '8px 12px',
                      borderRadius: 4,
                      fontSize: '18px',
                      zIndex: 10,
                    }}
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => setIgCarouselIndex(i => (i + 1) % igMediaItems.length)}
                    style={{
                      position: 'absolute',
                      right: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'rgba(0,0,0,0.5)',
                      border: 'none',
                      color: '#fff',
                      cursor: 'pointer',
                      padding: '8px 12px',
                      borderRadius: 4,
                      fontSize: '18px',
                      zIndex: 10,
                    }}
                  >
                    ›
                  </button>
                  <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 4, zIndex: 10 }}>
                    {igMediaItems.map((_, i) => (
                      <span
                        key={`ig-dot-${i}`}
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: i === currentMediaIdx ? '#fff' : 'rgba(255,255,255,0.4)',
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', padding: '8px 4px 4px', gap: 0 }}>
              <button style={{ background: 'none', border: 'none', cursor: 'default', color: '#f5f5f5', padding: 8, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                <img src={TEMPLATE_IG_ICONS.like} alt="" style={{ width: 22, height: 22 }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: '#f5f5f5' }}>108</span>
              </button>
              <button style={{ background: 'none', border: 'none', cursor: 'default', color: '#f5f5f5', padding: 8, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                <img src={TEMPLATE_IG_ICONS.comment} alt="" style={{ width: 22, height: 22 }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: '#f5f5f5' }}>2</span>
              </button>
              <button style={{ background: 'none', border: 'none', cursor: 'default', color: '#f5f5f5', padding: 8, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                <img src={TEMPLATE_IG_ICONS.share} alt="" style={{ width: 22, height: 22 }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: '#f5f5f5' }}>7</span>
              </button>
              <button style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'default', color: '#f5f5f5', padding: 8, display: 'flex', alignItems: 'center' }}>
                <img src={TEMPLATE_IG_ICONS.save} alt="" style={{ width: 22, height: 22 }} />
              </button>
            </div>

            <div style={{ padding: '0 12px 12px', fontSize: 14, lineHeight: 1.4, color: '#f0f2f5', whiteSpace: 'pre-wrap', textAlign: captionTextAlign, fontFamily: captionFontFamily }}>
              <span style={{ fontWeight: 600, direction: 'ltr', unicodeBidi: 'embed' }}>{username || preview.accountName}</span>
              <span
                style={{
                  marginLeft: captionDirection === 'rtl' ? 0 : 4,
                  marginRight: captionDirection === 'rtl' ? 4 : 0,
                  direction: captionDirection,
                  unicodeBidi: 'plaintext',
                }}
              >
                {previewCaption}
              </span>
              {showMore && (
                <span
                  style={{
                    marginLeft: captionDirection === 'rtl' ? 0 : 4,
                    marginRight: captionDirection === 'rtl' ? 4 : 0,
                    color: '#b0b3b8',
                    direction: 'ltr',
                    unicodeBidi: 'embed',
                  }}
                >
                  ... more
                </span>
              )}
            </div>
          </article>
        </div>
      )
    }

    if (preview.provider === 'facebook') {
      const showMore = captionHasMoreThanOneLine(caption, 72)
      const previewCaption = showMore ? truncateCaptionToOneLine(caption, 76) : caption

      return (
        <div style={{ background: '#f0f2f5', borderRadius: 12, padding: '10px 8px', display: 'flex', justifyContent: 'center' }}>
          <article style={{ width: '100%', maxWidth: 500, background: '#fff', borderRadius: 8, boxShadow: '0 1px 2px rgba(0,0,0,0.1)', overflow: 'hidden', color: '#050505', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' }}>
            <header style={{ display: 'flex', alignItems: 'center', padding: '12px 16px 10px' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #e63946, #9d0208)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0, overflow: 'hidden' }}>
                {preview.avatar
                  ? <img src={preview.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                  : (preview.accountName?.[0] || 'F').toUpperCase()
                }
              </div>

              <div style={{ marginLeft: 10, flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 15, color: '#050505' }}>{preview.accountName || 'Football 3 in 1'}</span>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#1877f2', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>✓</span>
                  <span style={{ color: '#65676b', fontSize: 13 }}>·</span>
                  <span style={{ color: '#1877f2', fontSize: 13, fontWeight: 600 }}>Suivre</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1, fontSize: 13, color: '#65676b' }}>
                  <span>1 h</span>
                  <span>·</span>
                  <Globe2 size={12} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', alignItems: 'center' }}>
                <button style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'transparent', color: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default' }}>
                  <MoreHorizontal size={20} />
                </button>
                <button style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'transparent', color: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default' }}>
                  <XIcon size={18} />
                </button>
              </div>
            </header>

            <p style={{ padding: '0 16px 12px', fontSize: 15, lineHeight: 1.33, color: '#050505', whiteSpace: 'pre-wrap', unicodeBidi: 'plaintext', margin: 0, direction: captionDirection, textAlign: captionTextAlign, fontFamily: captionFontFamily }}>
              <span>{previewCaption}</span>
              {showMore && (
                <span
                  style={{
                    marginLeft: captionDirection === 'rtl' ? 0 : 4,
                    marginRight: captionDirection === 'rtl' ? 4 : 0,
                    direction: 'ltr',
                    unicodeBidi: 'embed',
                  }}
                >
                  ... more
                </span>
              )}
            </p>

            {preview.link && (
              <div style={{ padding: '0 16px 10px', fontSize: 13, color: '#1877f2', overflowWrap: 'anywhere' }}>
                {preview.link}
              </div>
            )}

            <div>{renderFacebookMedia(preview.media)}</div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '14px 18px', borderTop: '1px solid #e4e6eb', color: '#65676b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img src={TEMPLATE_FB_ICONS.like} alt="" style={{ width: 22, height: 22 }} />
                <span style={{ fontSize: 15, fontWeight: 700, color: '#65686c' }}>407</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img src={TEMPLATE_FB_ICONS.comment} alt="" style={{ width: 22, height: 22 }} />
                <span style={{ fontSize: 15, fontWeight: 700, color: '#65686c' }}>6</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img src={TEMPLATE_FB_ICONS.share} alt="" style={{ width: 22, height: 22 }} />
                <span style={{ fontSize: 15, fontWeight: 700, color: '#65686c' }}>2</span>
              </div>

              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
                <img src={TEMPLATE_FB_ICONS.reactions} alt="" style={{ width: 40, height: 20 }} />
              </div>
            </div>
          </article>
        </div>
      )
    }

    if (preview.provider === 'twitter') {
      const showMore = captionHasMoreThanOneLine(caption, 70)
      const previewCaption = showMore ? truncateCaptionToOneLine(caption, 72) : caption
      const xUsername = '@' + (preview.accountName || 'account').replace(/\s+/g, '').toLowerCase()
      return (
        <div style={{ background: '#f5f8fa', borderRadius: 12, padding: '10px 8px', display: 'flex', justifyContent: 'center' }}>
          <article style={{ width: '100%', maxWidth: 600, background: '#ffffff', border: '1px solid #eff3f4', borderRadius: 16, padding: '12px 16px', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', color: '#0f1419' }}>
            <header style={{ display: 'flex', gap: 12 }}>
              <div style={{ flexShrink: 0 }}>
                {preview.avatar
                  ? <img src={preview.avatar} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} alt="" />
                  : <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #4a4a4a, #1a1a1a)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14 }}>{(preview.accountName?.[0] || 'A').toUpperCase()}</div>
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: '#0f1419' }}>{preview.accountName}</span>
                  <svg width="18" height="18" viewBox="0 0 22 22">
                    <path fill="#1d9bf0" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/>
                  </svg>
                  <span style={{ fontSize: 15, color: '#536471' }}>{xUsername}</span>
                  <span style={{ fontSize: 15, color: '#536471' }}>·</span>
                  <span style={{ fontSize: 15, color: '#536471' }}>now</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                <button style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src={TEMPLATE_X_ICONS.grok} alt="" style={{ width: 25, height: 25 }} />
                </button>
                <button style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#536471' }}>
                  <MoreHorizontal size={18} />
                </button>
              </div>
            </header>

            <div style={{ marginTop: 4, fontSize: 15, lineHeight: 1.5, color: '#0f1419', whiteSpace: 'pre-wrap', unicodeBidi: 'plaintext', direction: captionDirection, textAlign: captionTextAlign, fontFamily: captionFontFamily }}>
              {previewCaption}
              {showMore && <span style={{ color: '#536471' }}> ... more</span>}
            </div>

            {preview.media.length > 0 && (
              <div style={{ marginTop: 12, border: '1px solid #eff3f4', borderRadius: 16, overflow: 'hidden' }}>
                {renderXMedia(preview.media)}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, padding: '0 4px' }}>
              {[
                { src: TEMPLATE_X_ICONS.comment, count: '246' },
                { src: TEMPLATE_X_ICONS.repost, count: '193' },
                { src: TEMPLATE_X_ICONS.like, count: '3.2K' },
                { src: TEMPLATE_X_ICONS.views, count: '3.5M' },
              ].map(({ src, count }) => (
                <button key={src} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'default', color: '#536471', fontSize: 13, flex: 1, fontFamily: 'inherit' }}>
                  <span style={{ width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src={src} alt="" style={{ width: 22, height: 22 }} />
                  </span>
                  <span>{count}</span>
                </button>
              ))}
              <button style={{ background: 'none', border: 'none', cursor: 'default', color: '#536471' }}>
                <span style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" width={18} height={18}>
                    <path d="M19 21l-7-5-7 5V4a2 2 0 012-2h10a2 2 0 012 2z"/>
                  </svg>
                </span>
              </button>
              <button style={{ background: 'none', border: 'none', cursor: 'default', color: '#536471' }}>
                <span style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" width={18} height={18}>
                    <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
                    <polyline points="16 6 12 2 8 6"/>
                    <line x1="12" y1="2" x2="12" y2="15"/>
                  </svg>
                </span>
              </button>
            </div>
          </article>
        </div>
      )
    }

    if (preview.provider === 'tiktok') {
      const ttUsername = (preview.accountName || 'account').replace(/\s+/g, '').toLowerCase()
      const ttInitial = (preview.accountName?.[0] || 'T').toUpperCase()
      const ttHasVideo = preview.media.some(m => isVideoItem(m))
      const ttHasMedia = preview.media.length > 0
      return (
        <div style={{ background: '#1a1a1a', borderRadius: 12, padding: '10px 8px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, width: '100%', maxWidth: 1280, fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' }}>

            {/* Video area */}
            <div style={{ position: 'relative', flex: 1, aspectRatio: '16 / 9', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
              {!ttHasMedia ? (
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #2a2a2a 0%, #1a1a1a 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#bbb', fontSize: '0.82rem', padding: 16, textAlign: 'center' }}>
                  <AlertCircle size={28} color="#fe2c55" strokeWidth={2} />
                  <span style={{ color: '#fe2c55', fontWeight: 600 }}>TikTok requires a video</span>
                  <span style={{ fontSize: '0.75rem', color: '#aaa' }}>Upload an MP4 or MOV file to publish on TikTok</span>
                </div>
              ) : !ttHasVideo ? (
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #2a0a0a 0%, #1a0000 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#bbb', fontSize: '0.82rem', padding: 16, textAlign: 'center' }}>
                  <AlertCircle size={28} color="#fe2c55" strokeWidth={2} />
                  <span style={{ color: '#fe2c55', fontWeight: 700 }}>Images not supported on TikTok</span>
                  <span style={{ fontSize: '0.75rem', color: '#f88', lineHeight: 1.4 }}>TikTok only accepts video (MP4 or MOV).<br/>Remove the image and upload a video instead.</span>
                </div>
              ) : renderMediaFrame(preview.media.find(m => isVideoItem(m)), 'tt-prev-0', '16 / 9', null, { borderRadius: 0, background: '#000' })
              }
              {/* Mute button */}
              <button style={{ position: 'absolute', top: 16, left: 16, width: 36, height: 36, borderRadius: '50%', background: 'transparent', border: 'none', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}>
                <svg viewBox="0 0 24 24" fill="white" width={24} height={24}>
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                </svg>
              </button>
              {/* Caption overlay */}
              <div style={{ position: 'absolute', bottom: 12, left: 12, right: 12, padding: '10px 14px', borderRadius: 6, zIndex: 10, backdropFilter: 'blur(2px)' }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'white', marginBottom: 4 }}>{ttUsername}</div>
                <div style={{ fontSize: 13, color: 'white', lineHeight: 1.4, whiteSpace: 'pre-wrap', unicodeBidi: 'plaintext', direction: captionDirection }}>{caption}</div>
              </div>
              {/* Progress bar */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'rgba(255,255,255,0.2)', zIndex: 11 }}>
                <div style={{ height: '100%', width: '8%', background: '#fe2c55' }} />
              </div>
            </div>

            {/* Side rail */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, paddingBottom: 20, flexShrink: 0 }}>
              {/* Avatar + plus badge */}
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 8 }}>
                {preview.avatar
                  ? <img src={preview.avatar} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} alt="" />
                  : <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #e63946, #9d0208)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 14 }}>{ttInitial}</div>
                }
                <div style={{ position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)', width: 18, height: 18, borderRadius: '50%', background: '#fe2c55', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #1a1a1a' }}>
                  <img src={TEMPLATE_TT_ICONS.plus} style={{ width: 14, height: 14 }} alt="" />
                </div>
              </div>
              {/* Like */}
              <button style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'default', color: 'white', fontFamily: 'inherit' }}>
                <img src={TEMPLATE_TT_ICONS.like} alt="" style={{ width: 32, height: 32 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#e8e8e8' }}>187.6K</span>
              </button>
              {/* Comment */}
              <button style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'default', color: 'white', fontFamily: 'inherit' }}>
                <img src={TEMPLATE_TT_ICONS.comment} alt="" style={{ width: 32, height: 32 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#e8e8e8' }}>525</span>
              </button>
              {/* Bookmark */}
              <button style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'default', color: 'white', fontFamily: 'inherit' }}>
                <img src={TEMPLATE_TT_ICONS.save} alt="" style={{ width: 32, height: 32 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#e8e8e8' }}>11.4K</span>
              </button>
              {/* Share */}
              <button style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'default', color: 'white', fontFamily: 'inherit' }}>
                <img src={TEMPLATE_TT_ICONS.share} alt="" style={{ width: 32, height: 32 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#e8e8e8' }}>5332</span>
              </button>
            </div>
          </div>
        </div>
      )
    }

    // LinkedIn
    const liShowMore = captionHasMoreThanOneLine(caption, 72)
    const liPreviewCaption = liShowMore ? truncateCaptionToOneLine(caption, 76) : caption
    return (
      <div style={{ background: '#f4f2ee', borderRadius: 12, padding: '10px 8px', display: 'flex', justifyContent: 'center' }}>
        <article style={{ width: '100%', maxWidth: 540, background: '#ffffff', borderRadius: 12, boxShadow: '0 0 0 1px rgba(0,0,0,0.08)', overflow: 'hidden', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', color: '#000000e6' }}>

          {/* Header */}
          <header style={{ display: 'flex', padding: '12px 16px 0', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: 'linear-gradient(135deg, #c9a578, #8b6f3a)' }}>
              {preview.avatar
                ? <img src={preview.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 18 }}>{(preview.accountName?.[0] || 'L').toUpperCase()}</div>
              }
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: '#000000e6' }}>{preview.accountName}</span>
                {/* LinkedIn "in" badge */}
                <span style={{ width: 14, height: 14, background: '#0a66c2', borderRadius: 2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 9, fontWeight: 800, flexShrink: 0, fontFamily: 'Arial, sans-serif', letterSpacing: '-0.5px' }}>in</span>
                <span style={{ color: '#00000099', fontSize: 12, margin: '0 2px' }}>·</span>
                <span style={{ fontSize: 12, color: '#00000099', fontWeight: 600 }}>1st</span>
              </div>
              <div style={{ fontSize: 12, color: '#00000099', marginTop: 1, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Professional · Your Company</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1, fontSize: 12, color: '#00000099' }}>
                <span>5d</span>
                <span>·</span>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="#00000099">
                  <path d="M8 0a8 8 0 100 16A8 8 0 008 0zM2 8a6 6 0 012.5-4.9c.3 1 .9 2.1 2 2.6v.6c0 1.4 1.1 2.5 2.5 2.5.8 0 1.5.7 1.5 1.5v1.4A6 6 0 012 8zm11.2 2.4a1.5 1.5 0 00-1.2-.9H11v-2c0-.3-.2-.5-.5-.5h-3v-1h1c.3 0 .5-.2.5-.5V4.5H10c.6 0 1-.5 1-1v-.3A6 6 0 0113.2 10.4z"/>
                </svg>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', alignItems: 'center' }}>
              <button style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00000099' }}>
                <MoreHorizontal size={20} />
              </button>
              <button style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00000099' }}>
                <XIcon size={18} />
              </button>
            </div>
          </header>

          {/* Post text */}
          <div style={{ padding: '8px 16px 0', fontSize: 14, lineHeight: 1.43, color: '#000000e6', whiteSpace: 'pre-wrap', wordWrap: 'break-word', direction: captionDirection, textAlign: captionTextAlign, fontFamily: captionFontFamily }}>
            {liPreviewCaption}
            {liShowMore && <span style={{ color: '#00000099' }}> … more</span>}
          </div>

          {/* Media */}
          {preview.media.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {renderLinkedInMedia(preview.media)}
            </div>
          )}

          {/* Reactions row */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', fontSize: 12, color: '#00000099', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'linear-gradient(180deg, #4d99e6, #2671bf)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid white', fontSize: 9 }}>
                <svg viewBox="0 0 16 16" fill="white" width="9" height="9"><path d="M5.5 7.5V14H3.5c-.3 0-.5-.2-.5-.5v-5.5c0-.3.2-.5.5-.5h2zm8.3-.3c.4.3.7.8.7 1.3 0 .3-.1.6-.3.9.2.2.3.5.3.9 0 .5-.3 1-.7 1.2.1.2.2.5.2.7 0 .7-.6 1.3-1.3 1.3H9.9c-.6 0-1.1-.2-1.5-.6L7 11.4V8l1.9-3.4c.2-.4.6-.6 1-.6.7 0 1.2.6 1.2 1.3V7h2.6c.6 0 1.1.5 1.1 1.1z"/></svg>
              </div>
              <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'linear-gradient(180deg, #f5b13d, #d99818)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid white', fontSize: 9, marginLeft: -3 }}>
                <svg viewBox="0 0 16 16" fill="white" width="9" height="9"><path d="M2 13l3-9 3 6 3-4 3 7H2z"/></svg>
              </div>
            </div>
            <span style={{ fontSize: 12, color: '#00000099' }}>8</span>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', borderTop: '1px solid #00000014', padding: '4px 12px' }}>
            {[
              { src: TEMPLATE_LI_ICONS.like, label: 'Like' },
              { src: TEMPLATE_LI_ICONS.comment, label: 'Comment' },
              { src: TEMPLATE_LI_ICONS.repost, label: 'Repost' },
              { src: TEMPLATE_LI_ICONS.share, label: 'Send' },
            ].map(({ src, label }) => (
              <button key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '10px 4px', border: 'none', background: 'transparent', color: '#00000099', fontWeight: 600, fontSize: 13, cursor: 'default', borderRadius: 4, fontFamily: 'inherit' }}>
                <img src={src} alt="" style={{ width: 22, height: 22 }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
              </button>
            ))}
          </div>
        </article>
      </div>
    )
  }

  const contentTypeBadge = isVideoPost ? 'video' : editMediaKind === 'image' ? 'image' : 'text'

  // ─── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: embedded ? '100%' : 'calc(100vh - 3rem - 48px)', display: 'flex', flexDirection: 'column' }}>

      {/* Modal shell */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 20,
        border: '1px solid hsl(var(--border))',
        background: 'hsl(var(--surface))',
        boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
        overflow: 'hidden',
        minHeight: 0,
      }}>

        {/* ── HEADER ─────────────────────────────────────────────────────────── */}
        <div style={{
          flexShrink: 0,
          padding: '14px 20px',
          borderBottom: '1px solid hsl(var(--border) / 0.5)',
          background: 'hsl(var(--bg-alt) / 0.6)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <SquarePen size={18} style={{ color: 'hsl(var(--primary))' }} />
              {isEdit ? 'Edit Post' : 'New Post'}
              <button
                title="Platform tips"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--fg-muted))', padding: 2, lineHeight: 1, borderRadius: '50%', opacity: 0.6, display: 'flex', alignItems: 'center' }}
              >
                <CircleHelp size={15} />
              </button>
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                background: 'hsl(45 93% 47% / 0.15)', color: 'hsl(45 93% 65%)',
                border: '1px solid hsl(45 93% 47% / 0.3)',
              }}>Draft</span>
              <span style={{
                fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                background: 'hsl(var(--surface-alt))', color: 'hsl(var(--fg-muted))',
                border: '1px solid hsl(var(--border))',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                {contentTypeBadge === 'video' ? '🎥' : contentTypeBadge === 'image' ? '🖼' : '📝'}
                {contentTypeBadge}
              </span>
              <span style={{ fontSize: '0.7rem', color: 'hsl(var(--fg-muted))', display: 'flex', alignItems: 'center', gap: 4 }}>
                <CalendarClock size={11} />
                {scheduledAt ? formatDateTime(datetimeLocalValueToIso(scheduledAt)) : 'Not scheduled'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {totalErrors > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'hsl(var(--danger))', fontWeight: 600 }}>
                <AlertCircle size={14} /> {totalErrors} error{totalErrors > 1 ? 's' : ''}
              </span>
            )}
            {totalErrors === 0 && totalWarnings > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'hsl(var(--warning))', fontWeight: 600 }}>
                <AlertTriangle size={14} /> {totalWarnings} warning{totalWarnings > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* ── BODY ───────────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0, overflow: 'hidden' }}>

          {/* LEFT — Media panel */}
          <div style={{
            background: 'rgba(0,0,0,0.25)',
            borderRight: '1px solid hsl(var(--border) / 0.4)',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: showMediaEmpty ? 'center' : 'flex-start',
            padding: '1.5rem',
            gap: '1rem',
          }}>
            {showMediaEmpty ? (
              <div style={{
                width: '100%', maxWidth: 360,
                border: '2px dashed hsl(var(--border-bright))',
                borderRadius: 16,
                padding: '2.5rem 1.5rem',
                textAlign: 'center',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              }}>
                <Image size={48} style={{ color: 'hsl(var(--fg-muted))', opacity: 0.4 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: 4 }}>No media selected</div>
                  <div style={{ fontSize: '0.8rem', color: 'hsl(var(--fg-muted))' }}>
                    {mediaPickerTarget
                      ? (mediaPickerTarget === 'cover'
                        ? 'Choose a cover image in the library dialog.'
                        : mediaPickerTarget === 'video'
                          ? 'Choose a video in the library dialog.'
                          : 'Choose an image in the library dialog.')
                      : emptyMediaIntent === 'video'
                        ? 'Add a video, or optionally add a cover image after.'
                        : emptyMediaIntent === 'image'
                          ? 'Add an image or generate one with AI.'
                          : 'One image, or one video with an optional cover image.'}
                  </div>
                </div>
                {!mediaPickerTarget && (
                  <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {(emptyMediaIntent === 'image' || !emptyMediaIntent) && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => { setMediaIntent('image'); setMediaPickerTarget('image') }}
                        style={{ borderRadius: 999, fontSize: '0.8rem', padding: '0.45rem 1.1rem' }}
                      >
                        <Image size={14} strokeWidth={2} /> Add image
                      </button>
                    )}
                    {(emptyMediaIntent === 'video' || !emptyMediaIntent) && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => { setMediaIntent('video'); setMediaPickerTarget('video') }}
                        style={{ borderRadius: 999, fontSize: '0.8rem', padding: '0.45rem 1.1rem' }}
                      >
                        <Video size={14} strokeWidth={2} /> Add video
                      </button>
                    )}
                    {(emptyMediaIntent === 'image' || !emptyMediaIntent) && (
                      <button
                        className="btn btn-primary"
                        onClick={generateImageFromText}
                        disabled={!hasTextForAiImage || generatingImage}
                        style={{
                          borderRadius: 999,
                          fontSize: '0.8rem',
                          padding: '0.45rem 1.1rem',
                          background: 'linear-gradient(135deg, hsl(262 68% 60%), hsl(var(--primary)))',
                          opacity: (!hasTextForAiImage || generatingImage) ? 0.55 : 1,
                          cursor: (!hasTextForAiImage || generatingImage) ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <Sparkles size={14} strokeWidth={2} />
                        {generatingImage ? 'Generating image...' : hasTextForAiImage ? 'Generate image with AI' : 'Write text first'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                {legacyExtraImages.length > 0 && (
                  <div style={{
                    width: '100%', maxWidth: 360, padding: '10px 12px', borderRadius: 10,
                    background: 'hsl(var(--warning) / 0.12)', border: '1px solid hsl(var(--warning) / 0.35)',
                    fontSize: '0.75rem', color: 'hsl(var(--warning))', display: 'flex', gap: 8, alignItems: 'flex-start',
                  }}>
                    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      {editMediaKind === 'video' || isVideoPost
                        ? 'Extra images will be removed on save. Use “Add cover image” for a video thumbnail.'
                        : 'This post has multiple images. Only one image is supported — remove extras or pick a new image to replace all.'}
                    </span>
                  </div>
                )}
                <div style={{ width: '100%', display: 'grid', gridTemplateColumns: panelMedia.length === 1 ? '1fr' : 'repeat(2, 1fr)', gap: 8 }}>
                  {panelMedia.map((m, i) => {
                    const isCover = isCoverMediaItem(m)
                    const isVideo = isPrimaryVideoItem(m)
                    const mediaKey = m.id || m.uuid || m.path || m.url || m.thumb || `idx-${i}`
                    const previewUrl = getMediaPreviewUrl(m)
                    const failed = !!failedPreviews[mediaKey]
                    const posterUrl = isVideo && editorCover ? getMediaPreviewUrl(editorCover) : undefined

                    return (
                      <div key={mediaKey} style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: 'hsl(var(--surface))' }}>
                        {!previewUrl || failed ? (
                          <div style={{ minHeight: 180, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'hsl(var(--fg-muted))', fontSize: '0.72rem' }}>
                            <Image size={18} />
                            Preview unavailable
                          </div>
                        ) : isVideo ? (
                          <video
                            src={previewUrl}
                            poster={posterUrl}
                            style={{ width: '100%', display: 'block', maxHeight: 260, objectFit: 'cover' }}
                            controls
                            muted
                            playsInline
                            onError={() => markPreviewFailed(mediaKey)}
                          />
                        ) : (
                          <img
                            src={previewUrl}
                            alt={m.name || 'media'}
                            style={{ width: '100%', display: 'block', maxHeight: 260, objectFit: 'cover' }}
                            onError={() => markPreviewFailed(mediaKey)}
                          />
                        )}
                        {(isVideo || isCover) && (
                          <span style={{
                            position: 'absolute', bottom: 8, left: 8,
                            background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: '0.65rem',
                            fontWeight: 600, padding: '2px 8px', borderRadius: 999, backdropFilter: 'blur(4px)',
                          }}>
                            {isVideo ? 'Video' : 'Cover'}
                          </span>
                        )}
                        <button
                          onClick={() => removeMediaItem(m)}
                          style={{
                            position: 'absolute', top: 8, right: 8,
                            background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none',
                            borderRadius: '50%', width: 24, height: 24, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                            backdropFilter: 'blur(4px)',
                          }}
                        ><XIcon size={12} /></button>
                      </div>
                    )
                  })}
                </div>
                {!mediaPickerTarget && (
                  isVideoPost && hasVideoMedia ? (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                      <button
                        className="btn btn-secondary"
                        onClick={() => setMediaPickerTarget('video')}
                        style={{ borderRadius: 999, fontSize: '0.8rem' }}
                      >
                        <Video size={14} strokeWidth={2} />
                        Change video
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => setMediaPickerTarget('cover')}
                        style={{ borderRadius: 999, fontSize: '0.8rem' }}
                      >
                        <Image size={14} strokeWidth={2} />
                        {editorCover ? 'Change cover image' : 'Add cover image (optional)'}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                      <button
                        className="btn btn-secondary"
                        onClick={() => setMediaPickerTarget(isVideoPost ? 'video' : 'image')}
                        style={{ borderRadius: 999, fontSize: '0.8rem' }}
                      >
                        {isVideoPost ? <Video size={14} strokeWidth={2} /> : <Image size={14} strokeWidth={2} />}
                        {isVideoPost ? 'Change video' : 'Change image'}
                      </button>
                      {!isVideoPost && (
                        <button
                          className="btn btn-primary"
                          onClick={generateImageFromText}
                          disabled={!hasTextForAiImage || generatingImage}
                          style={{
                            borderRadius: 999, fontSize: '0.8rem',
                            background: 'linear-gradient(135deg, hsl(262 68% 60%), hsl(var(--primary)))',
                            opacity: (!hasTextForAiImage || generatingImage) ? 0.55 : 1,
                          }}
                        >
                          <Sparkles size={14} strokeWidth={2} />
                          {generatingImage ? 'Generating…' : 'Generate with AI'}
                        </button>
                      )}
                    </div>
                  )
                )}
                {mediaPickerTarget && (
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'hsl(var(--fg-muted))', textAlign: 'center' }}>
                    {mediaPickerTarget === 'cover'
                      ? 'Choose a cover image in the library dialog.'
                      : mediaPickerTarget === 'video'
                        ? 'Choose a video in the library dialog.'
                        : 'Choose an image in the library dialog.'}
                  </p>
                )}
              </>
            )}
          </div>

          {/* RIGHT — Editor */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'hsl(var(--bg-alt) / 0.3)', backdropFilter: 'blur(8px)' }}>

            {/* Tab bar */}
            <div style={{
              flexShrink: 0,
              padding: '0 16px',
              borderBottom: '1px solid hsl(var(--border) / 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex' }}>
                {rightTabs.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setRightTab(t.key)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '12px 14px', fontSize: '0.82rem', fontWeight: 600,
                      color: rightTab === t.key ? 'hsl(var(--fg))' : 'hsl(var(--fg-muted))',
                      borderBottom: rightTab === t.key ? '2px solid hsl(var(--primary))' : '2px solid transparent',
                      marginBottom: -1,
                      transition: 'color 0.15s',
                    }}
                  >{t.label}</button>
                ))}
              </div>
            </div>

            {/* Scrollable tab content */}
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>

              {/* ── TEXT TAB ── */}
              {rightTab === 'text' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  {/* Combined platform warnings for all selected accounts */}
                  {selectedAccountObjects.length > 0 && Object.values(accountWarnings).some(ws => ws.length > 0) && (
                    <div style={{ margin: '8px 12px 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {selectedAccountObjects.flatMap(acc => {
                        const warns = accountWarnings[acc.id] || []
                        const info = PLATFORM_INFO[acc.provider]
                        return warns.map((w, i) => (
                          <div key={`${acc.id}-${i}`} style={{
                            display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem',
                            padding: '6px 12px', borderRadius: 8,
                            background: w.level === 'error' ? 'hsl(var(--danger) / 0.12)' : 'hsl(var(--warning) / 0.12)',
                            color: w.level === 'error' ? 'hsl(var(--danger))' : 'hsl(var(--warning))',
                            border: `1px solid ${w.level === 'error' ? 'hsl(var(--danger)/0.25)' : 'hsl(var(--warning)/0.25)'}`,
                          }}>
                            {w.level === 'error' ? <AlertCircle size={13} /> : <AlertTriangle size={13} />}
                            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: info?.color || '#64748b', flexShrink: 0, display: 'inline-block' }} />
                              <strong style={{ fontWeight: 700 }}>{info?.label || acc.provider}:</strong> {w.msg}
                            </span>
                          </div>
                        ))
                      })}
                    </div>
                  )}

                  {/* Textarea area */}
                  <div style={{ flex: 1, padding: '12px 12px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{
                      flex: 1,
                      borderRadius: 12,
                      border: '1px solid hsl(var(--border))',
                      background: 'hsl(var(--surface) / 0.4)',
                      overflow: 'hidden',
                      display: 'flex', flexDirection: 'column',
                      transition: 'border-color 0.15s',
                      minHeight: 120,
                    }}>
                      <textarea
                        style={{
                          flex: 1, resize: 'none', border: 'none', outline: 'none',
                          background: 'transparent', padding: '14px 16px',
                          fontSize: '0.875rem', lineHeight: 1.65,
                          color: 'hsl(var(--fg))', fontFamily: 'inherit',
                          minHeight: 140,
                        }}
                        rows={8}
                        placeholder={getPlaceholder()}
                        value={text}
                        onChange={e => updateContent(e.target.value)}
                      />
                    </div>

                    {/* Link input */}
                    {showLinkInput && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          className="form-input"
                          type="url"
                          placeholder="https://example.com"
                          value={linkUrl}
                          onChange={e => updateLink(e.target.value)}
                          style={{ flex: 1, marginBottom: 0, borderRadius: 8 }}
                        />
                        <button className="btn btn-ghost btn-sm" onClick={removeLink}><XIcon size={13} /></button>
                      </div>
                    )}

                    {/* Char count bar */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.72rem' }}>
                        <span style={{ color: 'hsl(var(--fg-muted))' }}>Characters</span>
                        <span style={{ fontWeight: 600, color: count > limit ? 'hsl(var(--danger))' : count > limit * 0.9 ? 'hsl(var(--warning))' : 'hsl(var(--fg-muted))' }}>
                          {count} / {limit}
                        </span>
                      </div>
                      <div style={{ height: 4, background: 'hsl(var(--surface-alt))', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${Math.min(100, (count / limit) * 100)}%`,
                          background: count > limit ? 'hsl(var(--danger))' : count > limit * 0.9 ? 'hsl(var(--warning))' : 'hsl(var(--primary))',
                          borderRadius: 999, transition: 'width 0.3s ease, background 0.3s ease',
                        }} />
                      </div>
                    </div>

                    {/* First comment (when toggled) */}
                    {showFirstComment && hasCommentableAccount && (
                      <div style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: 10 }}>
                        <div style={{ fontSize: '0.72rem', color: 'hsl(var(--fg-muted))', marginBottom: 6 }}>First comment</div>
                        <textarea
                          style={{
                            width: '100%', resize: 'none', borderRadius: 8,
                            border: '1px solid hsl(var(--border))', background: 'hsl(var(--surface) / 0.4)',
                            padding: '10px 12px', fontSize: '0.8rem', color: 'hsl(var(--fg))',
                            fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                          }}
                          rows={2}
                          placeholder="Write the first comment..."
                          value={firstComment}
                          onChange={e => updateFirstComment(e.target.value)}
                        />
                      </div>
                    )}

                    {/* Facebook targeting */}
                    {showTargeting && hasFacebookAccount && (
                      <div style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: 10 }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 8 }}>Facebook Targeting</div>
                        <div style={{ fontSize: '0.72rem', color: 'hsl(var(--fg-muted))', marginBottom: 8 }}>
                          Choose countries where the post is visible.
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setShowCountryPicker(true)}
                            style={{ fontSize: '0.74rem', padding: '4px 12px', borderRadius: 8 }}
                          >Specify countries</button>

                          {selectedTargetCountries.length > 0 && (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={clearAllCountries}
                              style={{ fontSize: '0.72rem', padding: '3px 10px' }}
                            >Clear selection</button>
                          )}
                        </div>

                        <div style={{ fontSize: '0.72rem', color: 'hsl(var(--fg-muted))', marginBottom: 8, lineHeight: 1.5 }}>
                          {selectedTargetCountries.length === 0
                            ? 'No countries selected yet.'
                            : `${selectedTargetCountries.length} selected${selectedTargetCountries.length > 4 ? ` (${selectedCountryPreview}...)` : `: ${selectedCountryPreview}`}`}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input className="form-input" type="number" min={13} max={65} placeholder="Min age" value={targeting.age_min || ''} onChange={e => updateTargeting('age_min', e.target.value ? parseInt(e.target.value) : null)} style={{ flex: 1, fontSize: '0.8rem' }} />
                          <input className="form-input" type="number" min={13} max={65} placeholder="Max age" value={targeting.age_max || ''} onChange={e => updateTargeting('age_max', e.target.value ? parseInt(e.target.value) : null)} style={{ flex: 1, fontSize: '0.8rem' }} />
                        </div>
                      </div>
                    )}

                    {/* Schedule date */}
                    <div style={{ paddingBottom: 12 }}>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                        Publication date
                      </label>
                      <div style={{ position: 'relative' }}>
                        <CalendarClock size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--fg-muted))', pointerEvents: 'none' }} />
                        <input
                          className="form-input"
                          type="datetime-local"
                          value={scheduledAt}
                          onChange={e => setScheduledAt(e.target.value)}
                          style={{ paddingLeft: 32, borderRadius: 8, fontSize: '0.8rem' }}
                        />
                      </div>
                      <p className="text-xs text-muted" style={{ marginTop: 6 }}>
                        Times are in workspace timezone ({settings.timezone.replace(/_/g, ' ')}).
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── ACCOUNTS TAB ── */}
              {rightTab === 'accounts' && (
                <div style={{ padding: '12px' }}>
                  {!accounts.length ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'hsl(var(--fg-muted))', fontSize: '0.85rem' }}>
                      No accounts connected. Go to <strong>Accounts</strong> to connect one.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {accounts.map(acc => {
                        const info = PLATFORM_INFO[acc.provider]
                        const selected = selectedAccounts.includes(acc.id)
                        const selectable = canSelectAccountForPost(acc, { videoPost: isVideoPost })
                        const warns = selected ? (accountWarnings[acc.id] || []) : []
                        const hasErr = warns.some(w => w.level === 'error')
                        const hasWrn = !hasErr && warns.some(w => w.level === 'warning')
                        return (
                          <div
                            key={acc.id}
                            onClick={() => selectable && toggleAccount(acc.id)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                              borderRadius: 10, cursor: selectable ? 'pointer' : 'not-allowed', transition: 'all 0.15s',
                              opacity: selectable ? 1 : 0.55,
                              background: selected ? 'hsl(var(--primary) / 0.08)' : 'hsl(var(--surface))',
                              border: `1px solid ${selected ? 'hsl(var(--primary) / 0.3)' : 'hsl(var(--border))'}`,
                            }}
                          >
                            <div style={{ position: 'relative', flexShrink: 0 }}>
                              {acc.media?.avatar
                                ? <img src={acc.media.avatar} style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover' }} alt="" />
                                : <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'hsl(var(--surface-alt))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem' }}>{acc.name[0]}</div>}
                              {info && <span style={{ position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: '50%', background: info.color, border: '2px solid hsl(var(--surface))' }} />}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{acc.name}</div>
                              <div style={{ fontSize: '0.72rem', color: 'hsl(var(--fg-muted))' }}>
                                {info?.label || acc.provider}
                                {!selectable && acc.provider === 'tiktok' ? ' · video posts only' : ''}
                              </div>
                            </div>
                            {selected && (hasErr || hasWrn) && (
                              <span style={{ fontSize: '0.7rem', color: hasErr ? 'hsl(var(--danger))' : 'hsl(var(--warning))' }}>
                                {warns.length} issue{warns.length > 1 ? 's' : ''}
                              </span>
                            )}
                            <div style={{
                              width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                              border: `2px solid ${selected ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
                              background: selected ? 'hsl(var(--primary))' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {selected && <CheckCircle2 size={12} color="hsl(var(--bg))" strokeWidth={3} />}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Platform guide */}
                  {selectedAccountObjects.length > 0 && (
                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'hsl(var(--fg-muted))' }}>Platform Requirements</div>
                      {selectedAccountObjects.map(acc => {
                        const info = PLATFORM_INFO[acc.provider]
                        if (!info) return null
                        return (
                          <div key={acc.id} style={{ borderRadius: 8, border: '1px solid hsl(var(--border))', padding: '10px 12px', fontSize: '0.78rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, marginBottom: 6 }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: info.color }} />
                              {info.label} — {acc.name}
                            </div>
                            <div style={{ color: 'hsl(var(--fg-muted))', display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span>Char limit: <strong style={{ color: 'hsl(var(--fg))' }}>{(PROVIDER_LIMITS[acc.provider] || 5000).toLocaleString()}</strong></span>
                              {info.mediaRequired && <span style={{ color: 'hsl(var(--danger))' }}>⚠ Media required</span>}
                              {info.videoOnly && <span style={{ color: 'hsl(var(--danger))' }}>⚠ Video only (MP4/MOV)</span>}
                              {INSTAGRAM_PROVIDERS.includes(acc.provider) && <span>Images: JPEG only, max 8 MB, ratio 4:5–1.91:1</span>}
                              {acc.provider === 'twitter' && <span>Max 4 images or 1 video</span>}
                              {acc.provider === 'linkedin' && <span>Max 9 images or 1 video</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>

        {/* ── FOOTER ─────────────────────────────────────────────────────────── */}
        <div style={{
          flexShrink: 0,
          padding: '8px 12px',
          borderTop: '1px solid hsl(var(--border) / 0.4)',
          background: 'hsl(var(--bg-alt) / 0.7)',
          backdropFilter: 'blur(20px)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          {/* First comment / action input */}
          {hasCommentableAccount ? (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 0,
              borderRadius: 999, border: '1px solid hsl(var(--border))',
              background: 'hsl(var(--surface) / 0.5)', overflow: 'hidden', minWidth: 0,
            }}>
              <MessageSquare size={16} style={{ marginLeft: 12, color: 'hsl(var(--fg-muted))', flexShrink: 0 }} />
              <input
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'transparent',
                  padding: '8px 12px', fontSize: '0.82rem', color: 'hsl(var(--fg))', fontFamily: 'inherit',
                }}
                placeholder="Add a first comment..."
                value={firstComment}
                onChange={e => {
                  if (!showFirstComment) setShowFirstComment(true)
                  updateFirstComment(e.target.value)
                }}
              />
            </div>
          ) : (
            <div style={{ flex: 1 }} />
          )}

          <div style={{ width: 1, height: 24, background: 'hsl(var(--border))', flexShrink: 0 }} />

          {/* Toolbar buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setMediaPickerTarget(isVideoPost ? 'video' : 'image')}
              style={{ borderRadius: 10, gap: 5, fontSize: '0.78rem', padding: '5px 10px', color: 'hsl(var(--fg-muted))' }}
            ><Image size={15} strokeWidth={2} /> Media</button>

            {/* Targeting and Story buttons disabled for now — needed for ads */}
            {/* {hasFacebookAccount && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowTargeting(s => !s)}
                style={{ borderRadius: 10, gap: 5, fontSize: '0.78rem', padding: '5px 10px', color: showTargeting ? 'hsl(var(--primary))' : 'hsl(var(--fg-muted))' }}
              ><Target size={15} strokeWidth={2} /> Targeting</button>
            )} */}

            {/* {supportsStory && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setIsStory(s => !s)}
                style={{ borderRadius: 10, gap: 5, fontSize: '0.78rem', padding: '5px 10px', color: isStory ? '#e1306c' : 'hsl(var(--fg-muted))' }}
              ><Star size={15} strokeWidth={2} /> Story</button>
            )} */}

            {hasFacebookAccount && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setShowLinkInput(s => !s); if (!showLinkInput && !linkUrl) updateLink('') }}
                style={{ borderRadius: 10, gap: 5, fontSize: '0.78rem', padding: '5px 10px', color: showLinkInput ? 'hsl(var(--primary))' : 'hsl(var(--fg-muted))' }}
              ><Link2 size={15} strokeWidth={2} /> Link</button>
            )}

            {isEdit && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={del}
                style={{ borderRadius: 10, gap: 5, fontSize: '0.78rem', padding: '5px 10px', color: 'hsl(var(--danger))' }}
              ><Trash2 size={15} strokeWidth={2} /> Delete</button>
            )}
          </div>

          <div style={{ width: 8 }} />

          {/* Primary actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {selectedAccountObjects.length > 0 && (
              <button
                className="btn btn-ghost"
                onClick={openPreview}
                style={{ borderRadius: 999, fontSize: '0.82rem', padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
              ><Eye size={14} strokeWidth={2} /> Preview</button>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => save(false)}
              disabled={saving}
              style={{ borderRadius: 999, fontSize: '0.82rem', padding: '7px 18px' }}
            >Save Draft</button>
            <button
              className="btn btn-primary"
              onClick={() => save(true)}
              disabled={saving}
              style={{
                borderRadius: 999, fontSize: '0.82rem', padding: '7px 22px', fontWeight: 600,
                background: 'linear-gradient(135deg, hsl(262 68% 60%), hsl(221 83% 53%))',
                boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
              }}
            >
              {saving ? <span className="spinner" style={{ width: 14, height: 14 }} />
                : scheduledAt ? 'Schedule' : 'Publish'}
            </button>
          </div>
        </div>
      </div>

      {mediaPickerTarget && (
        <MediaPicker
          multiple={false}
          mediaKind={mediaPickerTarget === 'video' ? 'video' : 'image'}
          title={
            mediaPickerTarget === 'video'
              ? 'Select video'
              : mediaPickerTarget === 'cover'
                ? 'Select cover image'
                : 'Select image'
          }
          confirmLabel="Select"
          onSelect={handleMediaPickerSelect}
          onClose={() => setMediaPickerTarget(null)}
        />
      )}

      {showCountryPicker && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCountryPicker(false)}>
          <div className="modal" style={{ maxWidth: 760, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center justify-between" style={{ marginBottom: '0.75rem' }}>
              <h2 className="modal-title" style={{ margin: 0 }}>Specify Countries</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCountryPicker(false)}>✕</button>
            </div>

            <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: 'hsl(var(--fg-muted))' }}>
              Select countries where this post should be visible. Use Select all, then deselect a few countries if needed.
            </p>

            <input
              className="form-input"
              value={countryQuery}
              onChange={e => setCountryQuery(e.target.value)}
              placeholder="Search country by name or code"
              style={{ marginBottom: 10, fontSize: '0.82rem' }}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: '0.75rem', color: 'hsl(var(--fg-muted))' }}>
                {filteredCountries.length} countries • {selectedTargetCountries.length} selected
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={selectAllCountries}
                  disabled={allCountriesSelected}
                  style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                >Select all</button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={clearAllCountries}
                  disabled={selectedTargetCountries.length === 0}
                  style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                >Deselect all</button>
              </div>
            </div>

            <div style={{ flex: 1, overflow: 'auto', border: '1px solid hsl(var(--border))', borderRadius: 10, padding: 10 }}>
              {filteredCountries.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'hsl(var(--fg-muted))', fontSize: '0.8rem', padding: '1rem' }}>
                  No countries found for your search.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
                  {filteredCountries.map(([code, name]) => {
                    const sel = selectedTargetCountries.includes(code)
                    return (
                      <button
                        key={code}
                        onClick={() => toggleCountry(code)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          width: '100%', textAlign: 'left', borderRadius: 8, cursor: 'pointer',
                          padding: '8px 10px', fontSize: '0.78rem',
                          border: `1px solid ${sel ? 'hsl(var(--primary)/0.3)' : 'hsl(var(--border))'}`,
                          background: sel ? 'hsl(var(--primary) / 0.12)' : 'hsl(var(--surface-alt))',
                          color: sel ? 'hsl(var(--primary))' : 'hsl(var(--fg))',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>{name}</span>
                        <span style={{ opacity: 0.75, fontSize: '0.72rem', fontWeight: 700 }}>{code}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ marginTop: '1rem' }}>
              <button className="btn btn-primary" onClick={() => setShowCountryPicker(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {showPreviewModal && activePreview && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowPreviewModal(false)}>
          <div className="modal" style={{ maxWidth: 780, width: '100%', maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center justify-between" style={{ marginBottom: '0.75rem' }}>
              <h2 className="modal-title" style={{ margin: 0 }}>Post Preview</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowPreviewModal(false)}>✕</button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: '0.78rem', color: 'hsl(var(--fg-muted))', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid hsl(var(--border))', background: 'hsl(var(--surface-alt))', fontWeight: 600 }}>
                  {PLATFORM_INFO[activePreview.provider]?.label || activePreview.provider}
                </span>
                <span style={{ fontWeight: 600, color: 'hsl(var(--fg))' }}>{activePreview.accountName}</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={goPrevPreview}
                  disabled={previewItems.length <= 1}
                  style={{ padding: '4px 8px' }}
                ><ChevronLeft size={16} /></button>
                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--fg-muted))', minWidth: 56, textAlign: 'center' }}>
                  {Math.min(previewPosition + 1, previewItems.length)} / {previewItems.length}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={goNextPreview}
                  disabled={previewItems.length <= 1}
                  style={{ padding: '4px 8px' }}
                ><ChevronRight size={16} /></button>
              </div>
            </div>

            <div style={{ flex: 1, overflow: 'auto', paddingBottom: 4 }}>
              {renderPreviewByProvider(activePreview)}
              {activePreview.firstComment && (
                <div style={{ marginTop: 10, borderRadius: 10, border: '1px solid hsl(var(--border))', background: 'hsl(var(--surface-alt))', padding: '10px 12px', fontSize: '0.82rem', color: 'hsl(var(--fg-muted))', lineHeight: 1.45 }}>
                  <strong style={{ color: 'hsl(var(--fg))' }}>First comment:</strong> {activePreview.firstComment}
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ marginTop: '0.9rem' }}>
              <button className="btn btn-secondary" onClick={() => save(false)} disabled={saving}>
                Save Draft
              </button>
              <button className="btn btn-primary" onClick={() => save(true)} disabled={saving}>
                {scheduledAt ? 'Schedule' : 'Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialogHost />
    </div>
  )
}

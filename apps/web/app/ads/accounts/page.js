'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy route — unified accounts live at /accounts */
export default function AdsAccountsRedirect() {
  const router = useRouter()
  useEffect(() => {
    const qs = typeof window !== 'undefined' ? window.location.search : ''
    router.replace(`/accounts${qs}`)
  }, [router])
  return null
}

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AiProvidersRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/ai-integrations')
  }, [router])
  return null
}

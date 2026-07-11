'use client'

import { Suspense } from 'react'
import { useRouter } from 'next/navigation'
import NewPostWizard from '../../../components/NewPostWizard.js'
import AppLayout from '../../../components/AppLayout.js'

function NewPostContent() {
  const router = useRouter()
  return (
    <AppLayout>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '1rem 1rem 2rem', minHeight: 'calc(100vh - 80px)' }}>
        <NewPostWizard
          onClose={() => router.push('/posts')}
          onDone={() => router.push('/posts')}
        />
      </div>
    </AppLayout>
  )
}

export default function NewPostPage() {
  return (
    <Suspense
      fallback={(
        <AppLayout>
          <div className="flex-center" style={{ height: '50vh' }}>
            <div className="spinner" />
          </div>
        </AppLayout>
      )}
    >
      <NewPostContent />
    </Suspense>
  )
}

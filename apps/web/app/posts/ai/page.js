import AppLayout from '../../../components/AppLayout.js'
import AIPostCreator from '../../../components/AIPostCreator.js'
import Link from 'next/link'

export default function AIPostPage() {
  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-text">AI Post Creator</h1>
          <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
            Generate and publish social media posts with AI
          </p>
        </div>
        <Link href="/posts/new" className="btn btn-secondary btn-sm">
          ✎ Manual Editor
        </Link>
      </div>
      <AIPostCreator />
    </AppLayout>
  )
}

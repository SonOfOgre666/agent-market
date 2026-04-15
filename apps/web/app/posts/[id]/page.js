import PostEditor from '../../../components/PostEditor.js'
import AppLayout from '../../../components/AppLayout.js'

export default function EditPostPage({ params }) {
  return <AppLayout><PostEditor postId={params.id} /></AppLayout>
}

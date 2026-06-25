import { redirect } from 'next/navigation'

export default function KnowledgePageRedirect({ params }: { params: { id: string } }) {
  redirect(`/knowledge?page=${params.id}`)
}

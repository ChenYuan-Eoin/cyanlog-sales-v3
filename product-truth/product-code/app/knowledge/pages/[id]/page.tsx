import { redirect } from 'next/navigation'

export default async function KnowledgePageRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/knowledge?page=${id}`)
}

import { redirect, notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Sidebar } from '@/components/layout/Sidebar'
import { Topbar } from '@/components/layout/Topbar'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { projectKey: string }
}) {
  const session = await getSession()
  if (!session?.user) redirect('/login')

  const project = await prisma.project.findUnique({
    where: { key: params.projectKey },
    select: { id: true, key: true, name: true, ownerId: true },
  })

  if (!project) notFound()

  // Check access
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
  if (!isAdmin) {
    const isMember = await prisma.projectMember.findFirst({
      where: { projectId: project.id, userId: session.user.id },
    })
    const isOwner = project.ownerId === session.user.id
    if (!isMember && !isOwner) redirect('/projects')
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar projectKey={project.key} projectName={project.name} />
      <Topbar />
      <main className="ml-64 pt-14 min-h-screen">
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  )
}

import { PrismaClient, GlobalRole, ProjectRole, SprintStatus, IssueType, Priority, StatusCategory } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // ─── Clean up ─────────────────────────────────────────────────────────────
  await prisma.auditLog.deleteMany()
  await prisma.notification.deleteMany()
  await prisma.attachment.deleteMany()
  await prisma.comment.deleteMany()
  await prisma.issueWatcher.deleteMany()
  await prisma.issueLabel.deleteMany()
  await prisma.issueLink.deleteMany()
  await prisma.issue.deleteMany()
  await prisma.label.deleteMany()
  await prisma.workflowTransition.deleteMany()
  await prisma.boardColumn.deleteMany()
  await prisma.workflowStatus.deleteMany()
  await prisma.sprint.deleteMany()
  await prisma.projectMember.deleteMany()
  await prisma.project.deleteMany()
  await prisma.session.deleteMany()
  await prisma.account.deleteMany()
  await prisma.user.deleteMany()

  // ─── Users ────────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('password123', 12)

  const admin = await prisma.user.create({
    data: {
      email: 'admin@sprintboard.app',
      name: 'Alex Admin',
      passwordHash,
      role: GlobalRole.SUPER_ADMIN,
      avatarColor: '#6366F1',
      jobTitle: 'Super Administrator',
      department: 'Engineering',
    },
  })

  const pm = await prisma.user.create({
    data: {
      email: 'pm@sprintboard.app',
      name: 'Morgan PM',
      passwordHash,
      role: GlobalRole.MEMBER,
      avatarColor: '#10B981',
      jobTitle: 'Project Manager',
      department: 'Engineering',
    },
  })

  const dev1 = await prisma.user.create({
    data: {
      email: 'alice@sprintboard.app',
      name: 'Alice Developer',
      passwordHash,
      role: GlobalRole.MEMBER,
      avatarColor: '#F59E0B',
      jobTitle: 'Senior Frontend Engineer',
      department: 'Engineering',
    },
  })

  const dev2 = await prisma.user.create({
    data: {
      email: 'bob@sprintboard.app',
      name: 'Bob Backend',
      passwordHash,
      role: GlobalRole.MEMBER,
      avatarColor: '#EF4444',
      jobTitle: 'Backend Engineer',
      department: 'Engineering',
    },
  })

  const designer = await prisma.user.create({
    data: {
      email: 'carol@sprintboard.app',
      name: 'Carol Designer',
      passwordHash,
      role: GlobalRole.MEMBER,
      avatarColor: '#8B5CF6',
      jobTitle: 'UI/UX Designer',
      department: 'Design',
    },
  })

  const viewer = await prisma.user.create({
    data: {
      email: 'viewer@sprintboard.app',
      name: 'Victor Viewer',
      passwordHash,
      role: GlobalRole.MEMBER,
      avatarColor: '#06B6D4',
      jobTitle: 'Stakeholder',
      department: 'Business',
    },
  })

  console.log('✅ Users created')

  // ─── Projects ─────────────────────────────────────────────────────────────
  const devProject = await prisma.project.create({
    data: {
      key: 'DEV',
      name: 'Platform Development',
      description: 'Core platform engineering tasks including frontend, backend, and infrastructure work.',
      avatarColor: '#6366F1',
      ownerId: admin.id,
    },
  })

  const mktProject = await prisma.project.create({
    data: {
      key: 'MKT',
      name: 'Marketing Website',
      description: 'Marketing website redesign and content management system.',
      avatarColor: '#10B981',
      ownerId: pm.id,
    },
  })

  const opsProject = await prisma.project.create({
    data: {
      key: 'OPS',
      name: 'DevOps & Infrastructure',
      description: 'Cloud infrastructure, CI/CD pipelines, and operational tasks.',
      avatarColor: '#F59E0B',
      ownerId: admin.id,
    },
  })

  console.log('✅ Projects created')

  // ─── Project Members ──────────────────────────────────────────────────────
  await prisma.projectMember.createMany({
    data: [
      { projectId: devProject.id, userId: admin.id, role: ProjectRole.OWNER },
      { projectId: devProject.id, userId: pm.id, role: ProjectRole.SCRUM_MASTER },
      { projectId: devProject.id, userId: dev1.id, role: ProjectRole.MEMBER },
      { projectId: devProject.id, userId: dev2.id, role: ProjectRole.MEMBER },
      { projectId: devProject.id, userId: designer.id, role: ProjectRole.MEMBER },
      { projectId: devProject.id, userId: viewer.id, role: ProjectRole.VIEWER },
      { projectId: mktProject.id, userId: pm.id, role: ProjectRole.OWNER },
      { projectId: mktProject.id, userId: designer.id, role: ProjectRole.MEMBER },
      { projectId: mktProject.id, userId: dev1.id, role: ProjectRole.MEMBER },
      { projectId: opsProject.id, userId: admin.id, role: ProjectRole.OWNER },
      { projectId: opsProject.id, userId: dev2.id, role: ProjectRole.MEMBER },
    ],
  })

  console.log('✅ Project members added')

  // ─── Workflow Statuses (DEV project) ──────────────────────────────────────
  const createWorkflow = async (projectId: string) => {
    const todo = await prisma.workflowStatus.create({
      data: { projectId, name: 'To Do', category: StatusCategory.TODO, color: '#64748B', order: 0, isDefault: true },
    })
    const inProgress = await prisma.workflowStatus.create({
      data: { projectId, name: 'In Progress', category: StatusCategory.IN_PROGRESS, color: '#3B82F6', order: 1 },
    })
    const inReview = await prisma.workflowStatus.create({
      data: { projectId, name: 'In Review', category: StatusCategory.IN_PROGRESS, color: '#F59E0B', order: 2 },
    })
    const testing = await prisma.workflowStatus.create({
      data: { projectId, name: 'Testing', category: StatusCategory.IN_PROGRESS, color: '#8B5CF6', order: 3 },
    })
    const blocked = await prisma.workflowStatus.create({
      data: { projectId, name: 'Blocked', category: StatusCategory.IN_PROGRESS, color: '#EF4444', order: 4 },
    })
    const done = await prisma.workflowStatus.create({
      data: { projectId, name: 'Done', category: StatusCategory.DONE, color: '#10B981', order: 5 },
    })

    // Transitions
    const transitions = [
      { from: todo.id, to: inProgress.id, name: 'Start Progress' },
      { from: inProgress.id, to: inReview.id, name: 'Send for Review' },
      { from: inProgress.id, to: blocked.id, name: 'Block' },
      { from: inProgress.id, to: todo.id, name: 'Reopen' },
      { from: inReview.id, to: testing.id, name: 'Start Testing' },
      { from: inReview.id, to: inProgress.id, name: 'Return to Dev' },
      { from: testing.id, to: done.id, name: 'Approve' },
      { from: testing.id, to: inProgress.id, name: 'Fail Testing' },
      { from: blocked.id, to: inProgress.id, name: 'Unblock' },
      { from: done.id, to: todo.id, name: 'Reopen' },
    ]

    for (const t of transitions) {
      await prisma.workflowTransition.create({
        data: {
          projectId,
          fromStatusId: t.from,
          toStatusId: t.to,
          name: t.name,
        },
      })
    }

    return { todo, inProgress, inReview, testing, blocked, done }
  }

  const devWorkflow = await createWorkflow(devProject.id)
  const mktWorkflow = await createWorkflow(mktProject.id)
  const opsWorkflow = await createWorkflow(opsProject.id)

  console.log('✅ Workflow statuses and transitions created')

  // ─── Board Columns ────────────────────────────────────────────────────────
  const createColumns = async (projectId: string, workflow: typeof devWorkflow) => {
    await prisma.boardColumn.createMany({
      data: [
        { projectId, name: 'To Do', order: 0, color: '#F1F5F9', statusId: workflow.todo.id },
        { projectId, name: 'In Progress', order: 1, color: '#DBEAFE', statusId: workflow.inProgress.id, wipLimit: 5 },
        { projectId, name: 'In Review', order: 2, color: '#FEF9C3', statusId: workflow.inReview.id, wipLimit: 3 },
        { projectId, name: 'Done', order: 3, color: '#DCFCE7', statusId: workflow.done.id },
      ],
    })
    return await prisma.boardColumn.findMany({ where: { projectId }, orderBy: { order: 'asc' } })
  }

  const devColumns = await createColumns(devProject.id, devWorkflow)
  await createColumns(mktProject.id, mktWorkflow)
  await createColumns(opsProject.id, opsWorkflow)

  console.log('✅ Board columns created')

  // ─── Labels ───────────────────────────────────────────────────────────────
  await prisma.label.createMany({
    data: [
      { projectId: devProject.id, name: 'frontend', color: '#3B82F6' },
      { projectId: devProject.id, name: 'backend', color: '#10B981' },
      { projectId: devProject.id, name: 'database', color: '#F59E0B' },
      { projectId: devProject.id, name: 'auth', color: '#EF4444' },
      { projectId: devProject.id, name: 'performance', color: '#8B5CF6' },
      { projectId: devProject.id, name: 'security', color: '#EC4899' },
      { projectId: devProject.id, name: 'documentation', color: '#06B6D4' },
      { projectId: devProject.id, name: 'testing', color: '#84CC16' },
    ],
  })

  console.log('✅ Labels created')

  // ─── Sprints ──────────────────────────────────────────────────────────────
  const now = new Date()
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
  const fourWeeksLater = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000)

  const completedSprint = await prisma.sprint.create({
    data: {
      projectId: devProject.id,
      name: 'Sprint 1 - Foundation',
      goal: 'Set up project foundations including auth, database schema, and core UI components.',
      status: SprintStatus.COMPLETED,
      startDate: new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000),
      endDate: twoWeeksAgo,
      completedAt: twoWeeksAgo,
      order: 1,
    },
  })

  const activeSprint = await prisma.sprint.create({
    data: {
      projectId: devProject.id,
      name: 'Sprint 2 - Core Features',
      goal: 'Implement board management, issue creation/editing, and sprint lifecycle management.',
      status: SprintStatus.ACTIVE,
      startDate: twoWeeksAgo,
      endDate: twoWeeksLater,
      order: 2,
    },
  })

  const plannedSprint = await prisma.sprint.create({
    data: {
      projectId: devProject.id,
      name: 'Sprint 3 - Advanced Features',
      goal: 'Reports, notifications, workflow customization, and performance improvements.',
      status: SprintStatus.PLANNED,
      startDate: twoWeeksLater,
      endDate: fourWeeksLater,
      order: 3,
    },
  })

  console.log('✅ Sprints created')

  // ─── Issues ───────────────────────────────────────────────────────────────
  const updateCounter = async (projectId: string, count: number) => {
    await prisma.project.update({ where: { id: projectId }, data: { issueCounter: count } })
  }

  const createIssue = async (data: {
    key: string
    projectId: string
    sprintId?: string
    columnId?: string
    statusId: string
    type: IssueType
    priority: Priority
    title: string
    description?: string
    assigneeId?: string
    reporterId: string
    storyPoints?: number
    parentId?: string
    order?: number
  }) => {
    return prisma.issue.create({ data: { ...data, order: data.order ?? 0 } })
  }

  // Completed sprint issues
  const devTodoCol = devColumns[0]
  const devInProgCol = devColumns[1]
  const devDoneCol = devColumns[3]

  const issue1 = await createIssue({
    key: 'DEV-1', projectId: devProject.id, sprintId: completedSprint.id,
    columnId: devDoneCol.id, statusId: devWorkflow.done.id,
    type: IssueType.STORY, priority: Priority.HIGH,
    title: 'Setup Next.js project with TypeScript and Tailwind CSS',
    description: 'Initialize the Next.js 14 project with TypeScript, Tailwind CSS, and configure the development environment.',
    assigneeId: dev1.id, reporterId: admin.id, storyPoints: 3, order: 1,
  })

  const issue2 = await createIssue({
    key: 'DEV-2', projectId: devProject.id, sprintId: completedSprint.id,
    columnId: devDoneCol.id, statusId: devWorkflow.done.id,
    type: IssueType.STORY, priority: Priority.HIGH,
    title: 'Design and implement PostgreSQL database schema',
    description: 'Create the full Prisma schema with all required models: users, projects, sprints, issues, workflows, etc.',
    assigneeId: dev2.id, reporterId: admin.id, storyPoints: 5, order: 2,
  })

  const issue3 = await createIssue({
    key: 'DEV-3', projectId: devProject.id, sprintId: completedSprint.id,
    columnId: devDoneCol.id, statusId: devWorkflow.done.id,
    type: IssueType.STORY, priority: Priority.HIGHEST,
    title: 'Implement JWT authentication with NextAuth.js',
    description: 'Setup NextAuth with credentials provider, JWT strategy, and role-based session handling.',
    assigneeId: dev1.id, reporterId: admin.id, storyPoints: 8, order: 3,
  })

  // Active sprint issues
  const epic1 = await createIssue({
    key: 'DEV-4', projectId: devProject.id, sprintId: activeSprint.id,
    columnId: devInProgCol.id, statusId: devWorkflow.inProgress.id,
    type: IssueType.EPIC, priority: Priority.HIGHEST,
    title: 'Sprint Board Core Feature Set',
    description: 'Epic covering all core sprint board functionality including board view, backlog, and sprint management.',
    assigneeId: pm.id, reporterId: admin.id, storyPoints: 40, order: 1,
  })

  const issue5 = await createIssue({
    key: 'DEV-5', projectId: devProject.id, sprintId: activeSprint.id,
    columnId: devInProgCol.id, statusId: devWorkflow.inProgress.id,
    type: IssueType.STORY, priority: Priority.HIGH,
    title: 'Implement drag-and-drop board with @hello-pangea/dnd',
    description: 'Build the Kanban board with columns and cards that support drag-and-drop between columns. Persist order in database.',
    assigneeId: dev1.id, reporterId: pm.id, storyPoints: 8, order: 2,
  })

  const issue6 = await createIssue({
    key: 'DEV-6', projectId: devProject.id, sprintId: activeSprint.id,
    columnId: devTodoCol.id, statusId: devWorkflow.todo.id,
    type: IssueType.STORY, priority: Priority.HIGH,
    title: 'Build backlog view with sprint management',
    description: 'Create the backlog page showing all issues grouped by sprint. Allow dragging issues between sprints and backlog.',
    assigneeId: dev2.id, reporterId: pm.id, storyPoints: 5, order: 3,
  })

  const issue7 = await createIssue({
    key: 'DEV-7', projectId: devProject.id, sprintId: activeSprint.id,
    columnId: devTodoCol.id, statusId: devWorkflow.todo.id,
    type: IssueType.BUG, priority: Priority.MEDIUM,
    title: 'Fix issue counter race condition on concurrent creation',
    description: 'When multiple issues are created simultaneously, duplicate keys can be generated. Needs to use SELECT FOR UPDATE.',
    assigneeId: dev2.id, reporterId: dev1.id, storyPoints: 2, order: 4,
  })

  const issue8 = await createIssue({
    key: 'DEV-8', projectId: devProject.id, sprintId: activeSprint.id,
    columnId: devTodoCol.id, statusId: devWorkflow.todo.id,
    type: IssueType.TASK, priority: Priority.LOW,
    title: 'Add loading skeletons for board and backlog',
    description: 'Improve perceived performance by adding skeleton loaders while data is being fetched.',
    assigneeId: designer.id, reporterId: pm.id, storyPoints: 3, order: 5,
  })

  const issue9 = await createIssue({
    key: 'DEV-9', projectId: devProject.id, sprintId: activeSprint.id,
    columnId: devTodoCol.id, statusId: devWorkflow.todo.id,
    type: IssueType.STORY, priority: Priority.HIGH,
    title: 'Implement issue detail page with comments and activity log',
    description: 'Full issue detail view with all fields, comment section with mentions, attachment upload, and change history.',
    assigneeId: dev1.id, reporterId: pm.id, storyPoints: 8, order: 6,
  })

  // Subtasks
  await createIssue({
    key: 'DEV-10', projectId: devProject.id, sprintId: activeSprint.id,
    columnId: devTodoCol.id, statusId: devWorkflow.todo.id,
    type: IssueType.SUBTASK, priority: Priority.MEDIUM,
    title: 'Implement comment creation and editing',
    assigneeId: dev1.id, reporterId: pm.id, storyPoints: 2, parentId: issue9.id, order: 1,
  })

  await createIssue({
    key: 'DEV-11', projectId: devProject.id, sprintId: activeSprint.id,
    columnId: devTodoCol.id, statusId: devWorkflow.todo.id,
    type: IssueType.SUBTASK, priority: Priority.MEDIUM,
    title: 'Build activity/history log section',
    assigneeId: dev1.id, reporterId: pm.id, storyPoints: 2, parentId: issue9.id, order: 2,
  })

  // Backlog issues (no sprint)
  await createIssue({
    key: 'DEV-12', projectId: devProject.id,
    columnId: devTodoCol.id, statusId: devWorkflow.todo.id,
    type: IssueType.STORY, priority: Priority.MEDIUM,
    title: 'Build burndown chart report',
    description: 'Create sprint burndown chart using Recharts showing ideal vs actual progress.',
    assigneeId: undefined, reporterId: pm.id, storyPoints: 5, order: 1,
  })

  await createIssue({
    key: 'DEV-13', projectId: devProject.id,
    columnId: devTodoCol.id, statusId: devWorkflow.todo.id,
    type: IssueType.STORY, priority: Priority.LOW,
    title: 'Add dark mode support',
    description: 'Implement dark mode using Tailwind dark: prefix and a theme toggle in user settings.',
    assigneeId: undefined, reporterId: designer.id, storyPoints: 3, order: 2,
  })

  await createIssue({
    key: 'DEV-14', projectId: devProject.id,
    columnId: devTodoCol.id, statusId: devWorkflow.todo.id,
    type: IssueType.STORY, priority: Priority.MEDIUM,
    title: 'Mobile responsive layout for board and backlog',
    description: 'Ensure the board and backlog views are usable on mobile devices with appropriate layout changes.',
    assigneeId: undefined, reporterId: designer.id, storyPoints: 5, order: 3,
  })

  await createIssue({
    key: 'DEV-15', projectId: devProject.id,
    columnId: devTodoCol.id, statusId: devWorkflow.todo.id,
    type: IssueType.TASK, priority: Priority.LOW,
    title: 'Write API documentation',
    description: 'Document all REST API endpoints with request/response examples.',
    assigneeId: undefined, reporterId: admin.id, storyPoints: 3, order: 4,
  })

  await updateCounter(devProject.id, 15)

  // MKT project issues
  const mktColumns = await prisma.boardColumn.findMany({ where: { projectId: mktProject.id }, orderBy: { order: 'asc' } })
  const mktSprint = await prisma.sprint.create({
    data: {
      projectId: mktProject.id, name: 'Sprint 1 - Redesign',
      goal: 'Complete the homepage and navigation redesign.',
      status: SprintStatus.ACTIVE,
      startDate: twoWeeksAgo, endDate: twoWeeksLater, order: 1,
    },
  })

  await createIssue({
    key: 'MKT-1', projectId: mktProject.id, sprintId: mktSprint.id,
    columnId: mktColumns[0].id, statusId: mktWorkflow.todo.id,
    type: IssueType.STORY, priority: Priority.HIGH,
    title: 'Redesign homepage hero section',
    assigneeId: designer.id, reporterId: pm.id, storyPoints: 5, order: 1,
  })

  await createIssue({
    key: 'MKT-2', projectId: mktProject.id, sprintId: mktSprint.id,
    columnId: mktColumns[1].id, statusId: mktWorkflow.inProgress.id,
    type: IssueType.TASK, priority: Priority.MEDIUM,
    title: 'Set up CMS for blog posts',
    assigneeId: dev1.id, reporterId: pm.id, storyPoints: 8, order: 2,
  })

  await updateCounter(mktProject.id, 2)

  console.log('✅ Issues created')

  // ─── Comments ─────────────────────────────────────────────────────────────
  await prisma.comment.createMany({
    data: [
      {
        issueId: issue5.id, authorId: dev1.id,
        body: 'I\'ve started working on this. The DnD library is quite straightforward to use. Should be done by EOD.',
      },
      {
        issueId: issue5.id, authorId: pm.id,
        body: 'Great! Make sure to handle the case where the sprint has no active board.',
      },
      {
        issueId: issue7.id, authorId: dev2.id,
        body: 'Confirmed the race condition. Will use a Prisma transaction with `$executeRaw` to do an atomic increment.',
      },
      {
        issueId: issue1.id, authorId: admin.id,
        body: 'Completed. Next.js project initialized with App Router, TypeScript strict mode, and Tailwind CSS v3.',
      },
      {
        issueId: issue3.id, authorId: dev1.id,
        body: 'Auth is working. JWT tokens include userId, email, role, and project memberships in the payload.',
      },
    ],
  })

  console.log('✅ Comments created')

  // ─── Notifications ────────────────────────────────────────────────────────
  await prisma.notification.createMany({
    data: [
      {
        userId: dev1.id,
        type: 'ISSUE_ASSIGNED',
        title: 'Issue assigned to you',
        body: 'DEV-5: Implement drag-and-drop board has been assigned to you',
        link: '/projects/DEV/issues/DEV-5',
        isRead: false,
      },
      {
        userId: dev1.id,
        type: 'COMMENT_ADDED',
        title: 'New comment on DEV-5',
        body: 'Morgan PM commented: "Great! Make sure to handle the case where the sprint has no active board."',
        link: '/projects/DEV/issues/DEV-5',
        isRead: false,
      },
      {
        userId: dev2.id,
        type: 'ISSUE_ASSIGNED',
        title: 'Issue assigned to you',
        body: 'DEV-6: Build backlog view has been assigned to you',
        link: '/projects/DEV/issues/DEV-6',
        isRead: false,
      },
      {
        userId: pm.id,
        type: 'SPRINT_STARTED',
        title: 'Sprint started',
        body: 'Sprint 2 - Core Features has been started',
        link: '/projects/DEV/board',
        isRead: true,
      },
      {
        userId: admin.id,
        type: 'MEMBER_ADDED',
        title: 'New member added to DEV',
        body: 'Victor Viewer has joined Platform Development as Viewer',
        link: '/projects/DEV/settings/members',
        isRead: true,
      },
    ],
  })

  console.log('✅ Notifications created')

  // ─── Audit Logs ───────────────────────────────────────────────────────────
  await prisma.auditLog.createMany({
    data: [
      {
        actorId: admin.id, projectId: devProject.id,
        entityType: 'Project', entityId: devProject.id,
        action: 'created', changes: { name: 'Platform Development', key: 'DEV' },
      },
      {
        actorId: admin.id, projectId: devProject.id, issueId: issue1.id,
        entityType: 'Issue', entityId: issue1.id,
        action: 'created', changes: { title: 'Setup Next.js project with TypeScript and Tailwind CSS' },
      },
      {
        actorId: dev1.id, projectId: devProject.id, issueId: issue1.id,
        entityType: 'Issue', entityId: issue1.id,
        action: 'transitioned',
        changes: { from: 'To Do', to: 'In Progress' },
      },
      {
        actorId: dev1.id, projectId: devProject.id, issueId: issue1.id,
        entityType: 'Issue', entityId: issue1.id,
        action: 'transitioned',
        changes: { from: 'In Progress', to: 'Done' },
      },
      {
        actorId: admin.id, projectId: devProject.id,
        entityType: 'Sprint', entityId: activeSprint.id,
        action: 'started', changes: { name: 'Sprint 2 - Core Features' },
      },
    ],
  })

  console.log('✅ Audit logs created')

  console.log('\n🎉 Seed complete!')
  console.log('\n📧 Test accounts (password: password123):')
  console.log('  admin@sprintboard.app     - Super Admin')
  console.log('  pm@sprintboard.app        - Project Manager')
  console.log('  alice@sprintboard.app     - Developer (Frontend)')
  console.log('  bob@sprintboard.app       - Developer (Backend)')
  console.log('  carol@sprintboard.app     - Designer')
  console.log('  viewer@sprintboard.app    - Viewer')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

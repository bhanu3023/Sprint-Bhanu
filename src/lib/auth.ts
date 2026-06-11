import { NextAuthOptions, getServerSession } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import AzureADProvider from 'next-auth/providers/azure-ad'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    AzureADProvider({
      id: 'microsoft',
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
    }),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Please enter your email and password')
        }

        let user
        try {
          user = await prisma.user.findUnique({
            where: { email: credentials.email.toLowerCase() },
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (
            message.includes('Authentication failed') ||
            message.includes("credentials for") ||
            message.includes("Can't reach database") ||
            message.includes('Connection refused')
          ) {
            throw new Error(
              'Database connection failed. Update the DATABASE_URL in your .env file with the correct PostgreSQL username and password (e.g. postgres:YOUR_PASSWORD@localhost:5432/sprintboard), then restart the dev server.'
            )
          }
          throw err
        }

        if (!user) {
          throw new Error('No account found with this email')
        }

        if (!user.isActive) {
          throw new Error('Your account has been deactivated. Please contact an administrator.')
        }

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!isValid) {
          throw new Error('Incorrect password')
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          avatarUrl: user.avatarUrl,
          avatarColor: user.avatarColor,
        } as any
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as any).role
        token.avatarUrl = (user as any).avatarUrl
        token.avatarColor = (user as any).avatarColor
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
        session.user.avatarUrl = token.avatarUrl as string | undefined
        session.user.avatarColor = token.avatarColor as string
      }
      return session
    },
  },
}

export async function getSession() {
  return await getServerSession(authOptions)
}

export async function requireAuth() {
  const session = await getSession()
  if (!session?.user) {
    throw new Error('UNAUTHORIZED')
  }
  return session
}

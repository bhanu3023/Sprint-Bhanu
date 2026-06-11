import { config } from 'dotenv'
import path from 'path'

// Ensure .env is loaded (next.config.js also loads it; this covers all import paths)
config({ path: path.join(process.cwd(), '.env') })

import { PrismaClient } from '@prisma/client'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Add it to a .env file in the project root (see .env.example), then restart the dev server (npm run dev).'
  )
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Pass url explicitly so Prisma engine does not need to read env("DATABASE_URL") itself
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

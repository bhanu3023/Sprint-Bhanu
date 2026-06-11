'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function NotFound() {
  useEffect(() => {
    // Redirect to home after a short delay so the app can re-route (e.g. after reload)
    const t = setTimeout(() => {
      window.location.href = '/'
    }, 1500)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-semibold text-foreground mb-2">Page not found</h1>
      <p className="text-muted-foreground mb-6 text-center">
        This page could not be found. Redirecting you to the home page…
      </p>
      <Link
        href="/"
        className="text-primary hover:underline font-medium"
      >
        Go to home
      </Link>
    </div>
  )
}

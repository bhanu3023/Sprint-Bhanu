'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Loader2 } from 'lucide-react'

export function LoginForm() {
  const [isLoading, setIsLoading] = useState(false)

  const handleMicrosoftSignIn = async () => {
    setIsLoading(true)
    await signIn('microsoft', { callbackUrl: '/dashboard' })
  }

  return (
    <div className="bg-white rounded-2xl p-10 shadow-xl flex flex-col items-center">
      {/* Neutara Logo */}
      <div className="mb-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/neutara-logo.png" alt="Neutara Technologies" className="h-24 w-auto mx-auto" />
      </div>

      <h1 className="text-xl font-bold text-gray-900 mb-6">Sign in to your account</h1>

      <button
        onClick={handleMicrosoftSignIn}
        disabled={isLoading}
        className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <svg width="20" height="20" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
            <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
          </svg>
        )}
        Sign in with Microsoft
      </button>
    </div>
  )
}

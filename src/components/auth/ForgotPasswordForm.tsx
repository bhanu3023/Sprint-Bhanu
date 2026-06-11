'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { forgotPasswordSchema, type ForgotPasswordInput } from '@/lib/validations/auth.schema'
import { Loader2, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'

export function ForgotPasswordForm() {
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
  })

  const onSubmit = async (data: ForgotPasswordInput) => {
    setIsLoading(true)
    try {
      // In a real app, this would call a forgot password API endpoint
      await new Promise((r) => setTimeout(r, 1000))
      setSent(true)
      toast.success('Password reset instructions sent!')
    } finally {
      setIsLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8 shadow-2xl text-center">
        <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-white mb-2">Check your email</h1>
        <p className="text-slate-400 text-sm mb-6">
          We&apos;ve sent password reset instructions to your email address.
        </p>
        <Link href="/login" className="text-blue-400 hover:text-blue-300 text-sm font-medium">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8 shadow-2xl">
      <h1 className="text-2xl font-bold text-white mb-1">Reset password</h1>
      <p className="text-slate-400 text-sm mb-6">
        Enter your email and we&apos;ll send you reset instructions.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
          <input
            {...register('email')}
            type="email"
            placeholder="you@company.com"
            className="w-full px-3 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          Send Reset Instructions
        </button>
      </form>

      <div className="mt-6 text-center">
        <Link href="/login" className="text-slate-400 hover:text-slate-300 text-sm">
          ← Back to sign in
        </Link>
      </div>
    </div>
  )
}

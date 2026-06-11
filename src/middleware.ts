export { default } from 'next-auth/middleware'

export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico|login|signup|forgot-password|reset-password|.*\\.png|.*\\.jpg|.*\\.svg|.*\\.ico|.*\\.webp).*)',
  ],
}

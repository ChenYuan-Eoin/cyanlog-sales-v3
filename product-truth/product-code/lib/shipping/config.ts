import type { AuthUser } from '@/lib/auth'
export class ShippingError extends Error {
  constructor(public status: number, message: string, public requestStage?: 'validation' | 'provider_rejected' | 'provider_unreachable' | 'provider_http_error' | 'provider_invalid_response') {
    super(message)
  }
}

// Temporary access bootstrap remains separate from carrier credentials. The
// organization permission model is used for connection management and is the
// source of truth for runtime carrier settings.
export function allowedShippingUser(user: Pick<AuthUser, 'id'>, env: Record<string, string | undefined> = process.env): boolean {
  return (env.SHIPPING_ALLOWED_USER_IDS || '').split(',').map(value => value.trim()).filter(Boolean).includes(user.id)
}

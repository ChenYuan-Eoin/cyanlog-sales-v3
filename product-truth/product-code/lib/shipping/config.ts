export class ShippingError extends Error {
  constructor(public status: number, message: string, public requestStage?: 'validation' | 'provider_not_sent' | 'provider_rejected' | 'provider_unreachable' | 'provider_http_error' | 'provider_invalid_response') {
    super(message)
  }
}

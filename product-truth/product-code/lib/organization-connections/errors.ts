export class OrganizationConnectionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503 = 400,
  ) {
    super(message)
    this.name = 'OrganizationConnectionError'
  }
}

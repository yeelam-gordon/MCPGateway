export class GatewayError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'GatewayError';
    this.code = code;
  }
}
export function errorResult(error) {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({
    error: error instanceof GatewayError ? error.code : 'backend_error', message: error.message
  }) }] };
}

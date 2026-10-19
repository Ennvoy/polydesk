/** Only fixed, user-readable messages may cross the gateway boundary. */
export class GatewayFailure extends Error {
  constructor(public readonly kind: 'temporary' | 'unsafe', message: string) { super(message); }
}
export function gatewayFailure(error: unknown): GatewayFailure {
  return error instanceof GatewayFailure ? error : new GatewayFailure('unsafe', '無法安全確認 Tailscale 私人連線設定。');
}

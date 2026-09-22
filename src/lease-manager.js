import { GatewayError } from './errors.js';
export class LeaseManager {
  constructor() { this.owner = null; this.activeCalls = 0; this.pendingRelease = false; }
  claim(clientId) {
    if (this.owner && this.owner !== clientId) throw new GatewayError('lease_busy', 'Playwright is exclusively leased by another MCP client');
    this.owner = clientId; this.pendingRelease = false; return { claimed: true };
  }
  assertOwner(clientId) {
    if (this.owner !== clientId) throw new GatewayError('lease_required', 'Claim the Playwright lease before invoking Playwright tools');
  }
  begin(clientId) { this.assertOwner(clientId); this.activeCalls += 1; }
  end(clientId) { if (this.owner !== clientId) return; this.activeCalls -= 1; if (!this.activeCalls && this.pendingRelease) this.#clear(); }
  release(clientId) { this.assertOwner(clientId); if (this.activeCalls) this.pendingRelease = true; else this.#clear(); return { released: this.owner === null, pending: this.pendingRelease }; }
  disconnect(clientId) { if (this.owner !== clientId) return; if (this.activeCalls) this.pendingRelease = true; else this.#clear(); }
  #clear() { this.owner = null; this.pendingRelease = false; }
}

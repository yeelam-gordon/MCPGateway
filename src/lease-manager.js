import { GatewayError } from './errors.js';

export class LeaseManager {
  constructor() { this.leases = new Map(); }

  claim(server, clientId, required) {
    if (!required) throw new GatewayError('lease_not_required', `Backend ${server} does not require an exclusive lease`);
    const lease = this.#lease(server);
    this.#assertKnownOutcome(server, lease);
    if (lease.owner && lease.owner !== clientId) throw new GatewayError('lease_busy', `Backend ${server} is exclusively leased by another MCP client`);
    if (lease.pendingRelease) throw new GatewayError('lease_releasing', `Backend ${server} lease is being released`);
    lease.owner = clientId;
    return { claimed: true, server };
  }

  begin(server, clientId) {
    const lease = this.#lease(server);
    this.#assertKnownOutcome(server, lease);
    if (lease.pendingRelease) throw new GatewayError('lease_releasing', `Backend ${server} lease is being released`);
    this.#assertOwner(server, lease, clientId);
    lease.activeCalls += 1;
  }

  end(server, clientId, outcomeUnknown = false) {
    const lease = this.leases.get(server);
    if (!lease || lease.owner !== clientId || lease.activeCalls === 0) return;
    lease.activeCalls -= 1;
    if (outcomeUnknown) {
      lease.outcomeUnknown = true;
      lease.pendingRelease = false;
      const error = new GatewayError('server_outcome_unknown', `A prior ${server} call timed out with an unknown downstream outcome; restart the gateway before using ${server} again`);
      for (const waiter of lease.releaseWaiters.splice(0)) waiter.reject(error);
      return;
    }
    if (lease.activeCalls === 0 && lease.pendingRelease) this.#clear(server, lease);
  }

  async release(server, clientId, required) {
    if (!required) throw new GatewayError('lease_not_required', `Backend ${server} does not require an exclusive lease`);
    const lease = this.#lease(server);
    this.#assertKnownOutcome(server, lease);
    this.#assertOwner(server, lease, clientId);
    if (lease.pendingRelease) throw new GatewayError('lease_releasing', `Backend ${server} lease is already being released`);
    if (lease.activeCalls === 0) {
      this.#clear(server, lease);
      return { released: true, server };
    }
    lease.pendingRelease = true;
    return new Promise((resolve, reject) => lease.releaseWaiters.push({ resolve, reject }));
  }

  disconnect(clientId) {
    for (const [server, lease] of this.leases) {
      if (lease.owner !== clientId || lease.outcomeUnknown) continue;
      if (lease.activeCalls) lease.pendingRelease = true;
      else this.#clear(server, lease);
    }
  }

  #lease(server) {
    let lease = this.leases.get(server);
    if (!lease) {
      lease = { owner: null, activeCalls: 0, pendingRelease: false, outcomeUnknown: false, releaseWaiters: [] };
      this.leases.set(server, lease);
    }
    return lease;
  }

  #assertOwner(server, lease, clientId) {
    if (lease.owner !== clientId) throw new GatewayError('lease_required', `Claim the ${server} lease before invoking its tools`);
  }

  #assertKnownOutcome(server, lease) {
    if (lease.outcomeUnknown) throw new GatewayError('server_outcome_unknown', `A prior ${server} call timed out with an unknown downstream outcome; restart the gateway before using ${server} again`);
  }

  #clear(server, lease) {
    this.leases.delete(server);
    const waiters = lease.releaseWaiters.splice(0);
    for (const waiter of waiters) waiter.resolve({ released: true, server });
  }
}

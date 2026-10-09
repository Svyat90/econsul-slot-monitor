// Errors that cross the rings (onion-architecture §7): adapters throw them, use cases decide.

// HTTP 401/403 from e-Consul: the token no longer works. Monitoring stops and waits for a new token.
export class SessionExpiredError extends Error {
    readonly status: number;

    constructor(status: number, message = `HTTP ${status}`) {
        super(message);
        this.name = 'SessionExpiredError';
        this.status = status;
    }
}

// Any other failure to get an answer (5xx, network, Cloudflare): the check fails, monitoring goes on.
export class EconsulUnavailableError extends Error {
    readonly status: number | null; // null: no response at all

    constructor(status: number | null, message: string) {
        super(message);
        this.name = 'EconsulUnavailableError';
        this.status = status;
    }
}

// The answer did not match the contract: the site changed its format.
export class EconsulSchemaError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EconsulSchemaError';
    }
}

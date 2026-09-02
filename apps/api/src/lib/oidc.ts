import * as crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AppError } from './http';

/** The claims ProvaHR consumes from a verified OIDC access token. */
export interface OidcTokenInfo {
  sub: string;
  email: string;
  name: string;
  roles: string[];
}

/** A JSON Web Key as it appears in a JWKS document (loosely typed). */
type Jwk = Record<string, unknown>;

type JwksDocument = { keys: Jwk[] };

function isJwksDocument(value: unknown): value is JwksDocument {
  return typeof value === 'object' && value !== null && Array.isArray((value as JwksDocument).keys);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Caches the issuer's JWKS (JSON Web Key Set) and resolves key ids to
 * public keys. Keys are refreshed when stale or when an unknown `kid`
 * shows up (key rotation).
 */
export class JwksCache {
  private readonly issuerUrl: string;
  private readonly jwksOverride: unknown;
  private readonly refreshMs: number;
  /** Floor between unknown-kid refreshes: attacker-supplied random kids must
   *  not amplify into per-request upstream fetches (QA wave-1, F3). */
  private readonly rotationRetryMs: number;
  private keys: Jwk[] = [];
  private fetchedAt = 0;
  private jwksUri: string | null = null;
  private jwksUriFetchedAt = 0;

  /**
   * @param issuerUrl OIDC issuer, e.g. `http://localhost:8081/realms/provahr`.
   * @param opts.jwksOverride dependency-injection hook for tests: when set,
   *   the cache serves this JWKS-shaped object and never performs network I/O.
   * @param opts.refreshMs how long a fetched key set is trusted (default 10 min).
   */
  constructor(issuerUrl: string, opts?: { jwksOverride?: unknown; refreshMs?: number; rotationRetryMs?: number }) {
    this.issuerUrl = issuerUrl.replace(/\/+$/, '');
    this.jwksOverride = opts?.jwksOverride;
    this.refreshMs = opts?.refreshMs ?? 10 * 60 * 1000;
    this.rotationRetryMs = opts?.rotationRetryMs ?? 30_000;
  }

  /** Returns the RSA public key for `kid`, refreshing the cache if needed. */
  async getPublicKey(kid: string): Promise<crypto.KeyObject> {
    if (this.keys.length === 0 || Date.now() - this.fetchedAt >= this.refreshMs) {
      await this.loadKeys();
    }
    let jwk = this.findKey(kid);
    if (!jwk) {
      // Unknown kid — the issuer may have rotated keys since the last fetch.
      // Refresh at most once per rotationRetryMs so garbage kids cannot be
      // turned into a fetch flood against the issuer.
      if (Date.now() - this.fetchedAt >= this.rotationRetryMs) {
        await this.loadKeys();
        jwk = this.findKey(kid);
      }
    }
    if (!jwk) {
      throw new AppError(401, 'Unknown signing key', 'UNAUTHENTICATED');
    }
    return crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' });
  }

  private findKey(kid: string): Jwk | undefined {
    return this.keys.find(
      (key) =>
        key.kid === kid && key.kty === 'RSA' && typeof key.n === 'string' && typeof key.e === 'string',
    );
  }

  private async loadKeys(): Promise<void> {
    if (this.jwksOverride !== undefined) {
      this.setKeys(this.jwksOverride);
      return;
    }
    const res = await fetch(await this.resolveJwksUri(), {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`JWKS fetch failed with status ${res.status}`);
    }
    this.setKeys(await res.json());
  }

  /** Follows the (cached) discovery document; falls back to well-known JWKS. */
  private async resolveJwksUri(): Promise<string> {
    if (this.jwksUri && Date.now() - this.jwksUriFetchedAt < this.refreshMs) {
      return this.jwksUri;
    }
    try {
      const res = await fetch(`${this.issuerUrl}/.well-known/openid-configuration`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`discovery fetch failed with status ${res.status}`);
      }
      const doc = (await res.json()) as { jwks_uri?: unknown };
      const jwksUri = nonEmptyString(doc?.jwks_uri);
      if (!jwksUri) {
        throw new Error('discovery document has no jwks_uri');
      }
      this.jwksUri = jwksUri;
      this.jwksUriFetchedAt = Date.now();
      return jwksUri;
    } catch {
      this.jwksUri = `${this.issuerUrl}/.well-known/jwks.json`;
      this.jwksUriFetchedAt = Date.now();
      return this.jwksUri;
    }
  }

  private setKeys(document: unknown): void {
    if (!isJwksDocument(document)) {
      throw new Error('Invalid JWKS document: expected an object with a keys array');
    }
    this.keys = document.keys;
    this.fetchedAt = Date.now();
  }
}

/**
 * Verifies a Keycloak-issued access token (RS256, issuer + audience checked)
 * and extracts the claims ProvaHR needs.
 */
export async function verifyOidcToken(
  token: string,
  cfg: { issuerUrl: string; audience: string },
  jwks: JwksCache,
): Promise<OidcTokenInfo> {
  const decoded = jwt.decode(token, { complete: true });
  const header = decoded && typeof decoded === 'object' ? decoded.header : undefined;
  // Reject anything that is not RS256 before touching key material —
  // no alg-none / symmetric-key confusion games.
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new AppError(401, 'Invalid or expired token', 'UNAUTHENTICATED');
  }
  const publicKey = await jwks.getPublicKey(header.kid);

  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, publicKey, {
      issuer: cfg.issuerUrl,
      audience: cfg.audience,
      algorithms: ['RS256'],
    });
  } catch {
    throw new AppError(401, 'Invalid or expired token', 'UNAUTHENTICATED');
  }
  if (typeof payload === 'string') {
    throw new AppError(401, 'Invalid token payload', 'UNAUTHENTICATED');
  }

  const sub = nonEmptyString(payload.sub);
  if (!sub) {
    throw new AppError(401, 'Invalid token payload', 'UNAUTHENTICATED');
  }
  const email = nonEmptyString(payload.email);
  if (!email) {
    throw new AppError(401, 'Token missing email claim', 'UNAUTHENTICATED');
  }
  const name = nonEmptyString(payload.name) ?? nonEmptyString(payload.preferred_username) ?? email;

  const claims = payload as jwt.JwtPayload & {
    realm_access?: { roles?: unknown };
    resource_access?: Record<string, { roles?: unknown } | undefined>;
  };
  const realmRoles = stringArray(claims.realm_access?.roles);
  const clientRoles = stringArray(claims.resource_access?.[cfg.audience]?.roles);

  return { sub, email, name, roles: Array.from(new Set([...realmRoles, ...clientRoles])) };
}

const jwksCaches = new Map<string, JwksCache>();

/** Returns the process-wide JWKS cache for an issuer (shared across requests). */
export function getJwksCache(issuerUrl: string): JwksCache {
  let cache = jwksCaches.get(issuerUrl);
  if (!cache) {
    cache = new JwksCache(issuerUrl);
    jwksCaches.set(issuerUrl, cache);
  }
  return cache;
}

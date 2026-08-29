// SSRF-guarded page fetch for role-intake reference material (PLAN.md Phase 2).
//
// SECURITY MODEL, v1: `assertPublicHttpUrl` is a PURE check on the URL literal
// (protocol, credentials, host form) — it performs NO DNS resolution. A public
// hostname that resolves to a private IP at runtime is a RESIDUAL RISK accepted
// for v1; the post-fetch guard below (assertPublicHttpUrl(res.url)) only stops
// literal redirect targets, not DNS-level tricks (rebinding). Accepted and
// documented — do not feed this untrusted URLs in more sensitive contexts.

import { AppError } from './http';

const INVALID = 'Only public http(s) URLs are allowed';

/** Private/reserved IPv4 ranges (RFC1918 + loopback + link-local + this-network). */
function isPrivateIpv4(a: number, b: number, _c: number, _d: number): boolean {
  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // 10/8 private
    a === 127 || // 127/8 loopback
    (a === 169 && b === 254) || // 169.254/16 link-local (cloud metadata)
    (a === 172 && (b & 0xf0) === 16) || // 172.16/12 private
    (a === 192 && b === 168) // 192.168/16 private
  );
}

/**
 * Parses a dotted-quad IPv4 into octets, or null if malformed (an octet is
 * missing or > 255). WHATWG URL already canonicalizes numeric host forms
 * (e.g. http://2130706433 → 127.0.0.1) before we see them.
 */
function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

/**
 * Expands an IPv6 literal (with optional '::' compression and trailing
 * embedded dotted quad) to its 16 bytes, or null if malformed.
 */
function parseIpv6(host: string): number[] | null {
  let text = host;
  const pct = text.indexOf('%');
  if (pct !== -1) {
    text = text.slice(0, pct); // zone index carries no address bits; drop it
  }
  const doubleColonCount = (text.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return null;
  const [headRaw, tailRaw] = doubleColonCount === 1 ? text.split('::') : [text, undefined];

  const parseGroups = (segment: string): number[] | null => {
    if (segment === '') return [];
    const groups: number[] = [];
    for (const piece of segment.split(':')) {
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(piece)) {
        // Embedded IPv4 (e.g. ::ffff:192.0.2.1) — becomes the final 4 bytes.
        const v4 = parseIpv4(piece);
        if (!v4) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else if (/^[0-9a-fA-F]{1,4}$/.test(piece)) {
        groups.push(parseInt(piece, 16));
      } else {
        return null;
      }
    }
    return groups;
  };

  const head = parseGroups(headRaw ?? '');
  if (head === null) return null;
  const tail = parseGroups(tailRaw ?? '');
  if (tail === null) return null;

  const total = head.length + tail.length;
  const fill = doubleColonCount === 1 ? 8 - total : 0;
  if (doubleColonCount === 0 && total !== 8) return null;
  if (doubleColonCount === 1 && fill < 1) return null;

  const groups = [...head, ...new Array<number>(fill).fill(0), ...tail];
  const bytes: number[] = [];
  for (const g of groups) {
    bytes.push((g >> 8) & 0xff, g & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

function isPrivateIpv6(bytes: number[]): boolean {
  const [b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15] = bytes;
  // :: loopback
  const isLoopback =
    b0 === 0 && b1 === 0 && b2 === 0 && b3 === 0 && b4 === 0 && b5 === 0 &&
    b6 === 0 && b7 === 0 && b8 === 0 && b9 === 0 && b10 === 0 && b11 === 0 &&
    b12 === 0 && b13 === 0 && b14 === 0 && b15 === 1;
  // :: — the unspecified address. Dual-stack listeners treat it as "any",
  // so http://[::]:port REACHES local services (QA wave-3 F1, live-verified).
  const isUnspecified = bytes.every((b) => b === 0);
  // ff00::/8 multicast
  const isMulticast = b0 === 0xff;
  // fc00::/7 unique-local
  const isUniqueLocal = b0! >= 0xfc && b0! <= 0xfd;
  // fe80::/10 link-local
  const isLinkLocal = b0 === 0xfe && (b1! & 0xc0) === 0x80;
  // Embedding prefixes (defense-in-depth, QA wave-3 F3): NAT64 64:ff9b::/96,
  // 6to4 2002::/16, Teredo 2001:0::/32 all carry an IPv4 target inside.
  const isNat64 = b0 === 0x00 && b1 === 0x64 && b2 === 0xff && b3 === 0x9b;
  const is6to4 = b0 === 0x20 && b1 === 0x02;
  const isTeredo = b0 === 0x20 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00;
  // ::ffff:0:0/96 IPv4-mapped — check the embedded IPv4 against v4 ranges
  const isMapped =
    b0 === 0 && b1 === 0 && b2 === 0 && b3 === 0 && b4 === 0 && b5 === 0 &&
    b6 === 0 && b7 === 0 && b8 === 0 && b9 === 0 && b10 === 0xff && b11 === 0xff;
  return (
    isLoopback ||
    isUnspecified ||
    isMulticast ||
    isUniqueLocal ||
    isLinkLocal ||
    isNat64 ||
    is6to4 ||
    isTeredo ||
    (isMapped && isPrivateIpv4(b12!, b13!, b14!, b15!))
  );
}

/**
 * Validates that `raw` is an http(s) URL pointing at a public-looking target,
 * and returns the parsed URL. Pure — no DNS. Rejects:
 * - non-http(s) protocols (ftp:, file:, ...)
 * - embedded credentials (https://user:pass@host)
 * - empty hosts
 * - 'localhost', '*.localhost', '*.local', '*.internal' hostnames
 * - IPv4 literals in private/reserved ranges (127/8, 10/8, 172.16/12,
 *   192.168/16, 169.254/16, 0.0.0.0/8)
 * - IPv6 ::1, fc00::/7, fe80::/10, and ::ffff:-mapped versions of the above.
 * Any port is allowed.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, INVALID, 'INVALID_URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError(400, INVALID, 'INVALID_URL');
  }
  if (url.username !== '' || url.password !== '') {
    throw new AppError(400, INVALID, 'INVALID_URL');
  }

  // URL.hostname is already lowercased; IPv6 literals keep their brackets.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === '') {
    throw new AppError(400, INVALID, 'INVALID_URL');
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new AppError(400, INVALID, 'INVALID_URL');
  }

  const v4 = parseIpv4(host);
  if (v4) {
    if (isPrivateIpv4(v4[0], v4[1], v4[2], v4[3])) {
      throw new AppError(400, INVALID, 'INVALID_URL');
    }
    return url;
  }
  if (host.includes(':')) {
    const v6 = parseIpv6(host);
    if (v6 && isPrivateIpv6(v6)) {
      throw new AppError(400, INVALID, 'INVALID_URL');
    }
  }
  return url;
}

const USER_AGENT = 'ProvaHR-JDGenerator/0.1 (+https://github.com/YOUR_ORG/provahr)';

function isAcceptableContentType(contentType: string): boolean {
  const mime = contentType.split(';')[0]!.trim().toLowerCase();
  return (
    mime.startsWith('text/html') ||
    mime.startsWith('text/plain') ||
    mime.startsWith('application/json')
  );
}

/**
 * Strips script/style blocks and tags from HTML and collapses whitespace,
 * capped at `maxChars`. Pure, regex-based — good enough for LLM context
 * material, not a renderer.
 */
export function extractText(html: string, maxChars = 20_000): string {
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.slice(0, maxChars);
}

/**
 * Fetches a page and returns its extracted text. The URL literal is checked
 * before the request AND the final (post-redirect) URL is re-checked after —
 * Node's fetch follows redirects by default. Bodies are read fully into
 * memory and then capped — memory-naive, accepted for v1.
 */
export async function fetchPageText(
  raw: string,
  opts?: { timeoutMs?: number; maxBytes?: number },
): Promise<{ url: string; text: string }> {
  const url = assertPublicHttpUrl(raw);
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 15_000),
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain,application/json' },
  });
  if (!res.ok) {
    // Guard the FINAL url first: a redirect that landed on a private literal
    // must not leak that target's HTTP status through this message (QA wave-3
    // F4 — status/existence oracle for internal services).
    assertPublicHttpUrl(res.url);
    throw new AppError(502, `URL returned HTTP ${res.status}`, 'FETCH_FAILED');
  }
  // Post-fetch guard: a redirect may have landed on a literal private target.
  assertPublicHttpUrl(res.url);
  const contentType = res.headers.get('content-type') ?? '';
  if (!isAcceptableContentType(contentType)) {
    throw new AppError(415, `Unsupported content type: ${contentType || '(none)'}`, 'UNSUPPORTED_MEDIA_TYPE');
  }
  const body = await res.text();
  // Char-count cap on a byte budget (multi-byte chars under-count) — v1 naive.
  const capped = body.slice(0, opts?.maxBytes ?? 2_000_000);
  return { url: res.url, text: extractText(capped) };
}

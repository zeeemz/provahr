import { describe, it, expect } from 'vitest';
import { assertPublicHttpUrl, extractText } from '../src/lib/urlFetch';
import { AppError } from '../src/lib/http';

// fetchPageText itself needs the network — CI integration tier. The SSRF
// guard and the text extractor are pure and fully covered here.

function expectRejected(raw: string): void {
  let err: unknown;
  try {
    assertPublicHttpUrl(raw);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(AppError);
  const appErr = err as AppError;
  expect(appErr.statusCode).toBe(400);
  expect(appErr.code).toBe('INVALID_URL');
}

describe('assertPublicHttpUrl — accepted', () => {
  it('accepts plain https URLs with paths', () => {
    const url = assertPublicHttpUrl('https://example.com/x?y=1');
    expect(url.hostname).toBe('example.com');
  });

  it('accepts public IPv4 literals', () => {
    expect(assertPublicHttpUrl('http://8.8.8.8/').hostname).toBe('8.8.8.8');
    // 172.32.0.1 is just outside the 172.16/12 private range — must pass.
    expect(assertPublicHttpUrl('http://172.32.0.1/').hostname).toBe('172.32.0.1');
  });

  it('accepts public IPv6 literals', () => {
    expect(assertPublicHttpUrl('https://[2606:4700::1111]/').hostname).toBe('[2606:4700::1111]');
  });

  it('allows any port', () => {
    expect(assertPublicHttpUrl('https://example.com:8443/path').port).toBe('8443');
  });
});

describe('assertPublicHttpUrl — rejected', () => {
  it('rejects private/reserved IPv4 literals', () => {
    expectRejected('http://127.0.0.1/');
    expectRejected('http://10.1.2.3/');
    expectRejected('http://172.16.0.1/');
    expectRejected('http://192.168.1.1/');
    expectRejected('http://169.254.169.254/'); // cloud metadata
    expectRejected('http://0.0.0.0/');
    expectRejected('http://172.31.255.255/'); // 172.16/12 upper edge
  });

  it('rejects private/reserved IPv6 literals, including mapped v4', () => {
    expectRejected('http://[::1]/');
    expectRejected('http://[fc00::1]/');
    expectRejected('http://[fd12:3456::1]/'); // fc00::/7 upper half
    expectRejected('http://[fe80::1]/');
    expectRejected('http://[::ffff:127.0.0.1]/');
    expectRejected('http://[::ffff:10.0.0.1]/');
    expectRejected('http://[::ffff:192.168.0.1]/');
  });

  it('rejects the unspecified address [::] — dual-stack listeners treat it as any (QA wave-3 F1)', () => {
    expectRejected('http://[::]/');
    expectRejected('http://[::]:8081/');
    expectRejected('http://[0:0:0:0:0:0:0:0]/');
  });

  it('rejects multicast and v4-embedding prefixes (QA wave-3 F3 defense-in-depth)', () => {
    expectRejected('http://[ff02::1]/'); // multicast
    expectRejected('http://[64:ff9b::7f00:1]/'); // NAT64 → 127.0.0.1
    expectRejected('http://[64:ff9b::c0a8:1]/'); // NAT64 → 192.168.0.1
    expectRejected('http://[2002:7f00:1::1]/'); // 6to4 → 127.0.0.1
    expectRejected('http://[2001:0:7f00:1::1]/'); // Teredo → 127.0.0.1
  });

  it('rejects IPv4 notation tricks (WHATWG canonicalizes before the check — QA wave-3 F8)', () => {
    // WHATWG URL turns all of these into 127.0.0.1 before the guard sees them.
    expectRejected('http://2130706433/');
    expectRejected('http://0x7f000001/');
    expectRejected('http://0x7f.1/');
    expectRejected('http://127.1/');
    expectRejected('http://0177.0.0.1/');
    expectRejected('http://127.000.000.001/');
  });

  it('rejects local-ish hostnames', () => {
    expectRejected('http://localhost/');
    expectRejected('http://sub.localhost/');
    expectRejected('http://foo.internal/');
    expectRejected('http://bar.local/');
    expectRejected('http://api.corp.internal/x');
  });

  it('rejects non-http(s) protocols and credentials', () => {
    expectRejected('ftp://example.com/');
    expectRejected('file:///etc/passwd');
    expectRejected('https://user:pass@example.com/');
    expectRejected('https://user@example.com/');
  });
});

describe('extractText', () => {
  const sample = [
    '<html><head>',
    '<style>.x { color: red }</style>',
    "<script>alert('evil')</script>",
    '</head><body>',
    '<h1>  Senior   Engineer </h1>',
    '<p>Own the payments platform &amp; mentor.</p>',
    '<div data-x="1">Remote friendly</div>',
    '</body></html>',
  ].join('\n');

  it('strips script/style blocks and all tags', () => {
    const text = extractText(sample);
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color');
    expect(text).not.toContain('<');
    expect(text).toContain('Senior Engineer');
    expect(text).toContain('Own the payments platform &amp; mentor.');
    expect(text).toContain('Remote friendly');
  });

  it('collapses whitespace', () => {
    expect(extractText('a\nn\tt   x')).toBe('a n t x');
  });

  it('respects maxChars', () => {
    const long = `<p>${'a'.repeat(100)}</p>`;
    expect(extractText(long, 10)).toBe('aaaaaaaaaa');
    expect(extractText(long)).toBe('a'.repeat(100)); // default cap is 20k
  });
});

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TlsCertificate } from '../http/server';

/**
 * Test-only: a self-signed certificate for localhost and 127.0.0.1, valid one day, made with `openssl` (present on the
 * developers' machines and the CI runners). The private key never leaves the test process.
 */
export function throwawayCertificate(): TlsCertificate {
  const folder = mkdtempSync(path.join(tmpdir(), 'sayes-tls-'));
  try {
    const key = path.join(folder, 'key.pem');
    const cert = path.join(folder, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'pipe' });
    return { cert: readFileSync(cert, 'utf8'), key: readFileSync(key, 'utf8') };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

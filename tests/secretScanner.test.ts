import { scanChanges, scanPath, scanText, shannonEntropy } from '@/core/security/secretScanner';

describe('secret scanner', () => {
  it('detects common provider tokens with a redacted preview', () => {
    const text = [
      'const gh = "ghp_aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5";',
      'const g = "AIzaSyD4kq9Lr7Hc2Vbn5Xw1Pq8Zt6Ym3Ja0Ks9";',
      'aws = "AKIAIOSFODNN7EXAMPL2"',
      'anthropic = "sk-ant-api03-Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1"',
    ].join('\n');
    const f = scanText('src/config.ts', text);
    const ids = f.map((x) => x.ruleId).sort();
    expect(ids).toEqual(['anthropic-key', 'aws-access-key', 'github-pat', 'google-api-key']);
    expect(f.find((x) => x.ruleId === 'google-api-key')?.line).toBe(2);
    for (const finding of f) expect(text.includes(finding.preview)).toBe(false);
  });

  it('flags private key blocks and credential URLs', () => {
    const f = scanText('k', '-----BEGIN RSA PRIVATE KEY-----\nMIIE\npostgres://admin:S3cretPassw0rd@db.example.com/app');
    expect(f.map((x) => x.ruleId)).toEqual(expect.arrayContaining(['private-key', 'db-url-password']));
  });

  it('ignores obvious placeholders and low-entropy values', () => {
    expect(scanText('a', 'api_key = "your_api_key_goes_here_xxxxxxx"')).toHaveLength(0);
    expect(scanText('a', 'password = "aaaaaaaaaaaaaaaaaaaaaaaa"')).toHaveLength(0);
  });

  it('catches high-entropy generic assignments', () => {
    expect(scanText('a', 'client_secret: "9fK2xQ7mZp4LwR8tV1cN6bH3"').map((x) => x.ruleId)).toEqual(['generic-assignment']);
  });

  it('blocks .env files but allows .env.example', () => {
    expect(scanPath('.env')?.ruleId).toBe('sensitive-file');
    expect(scanPath('apps/web/.env.production')?.ruleId).toBe('sensitive-file');
    expect(scanPath('.env.example')).toBeNull();
    expect(scanPath('certs/server.pem')?.ruleId).toBe('sensitive-file');
  });

  it('scans a whole change set, binary files by path only', () => {
    const findings = scanChanges([
      { path: 'README.md', text: 'hello' },
      { path: 'id_rsa', text: null },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('computes entropy', () => {
    expect(shannonEntropy('aaaa')).toBe(0);
    expect(shannonEntropy('abcd')).toBe(2);
  });
});

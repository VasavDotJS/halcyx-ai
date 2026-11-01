/**
 * Gitleaks-style detection rules. Each rule has a regex and optional entropy floor.
 * Patterns are intentionally anchored to known token prefixes to keep false positives low.
 */
export type SecretRule = {
  id: string;
  description: string;
  regex: RegExp;
  /** Minimum Shannon entropy (bits/char) of the captured secret; filters placeholders. */
  minEntropy?: number;
  /** Capture group holding the secret value (default: whole match). */
  group?: number;
};

export const SECRET_RULES: SecretRule[] = [
  { id: 'aws-access-key', description: 'AWS access key ID', regex: /\b((?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16})\b/g, group: 1 },
  {
    id: 'aws-secret-key',
    description: 'AWS secret access key',
    regex: /aws_?secret_?access_?key["'\s:=]+([A-Za-z0-9/+=]{40})\b/gi,
    group: 1,
    minEntropy: 4,
  },
  { id: 'github-pat', description: 'GitHub token', regex: /\b(gh[pousr]_[A-Za-z0-9]{36,255})\b/g, group: 1 },
  { id: 'github-fine-grained', description: 'GitHub fine-grained token', regex: /\b(github_pat_[A-Za-z0-9_]{82})\b/g, group: 1 },
  { id: 'google-api-key', description: 'Google API key', regex: /\b(AIza[0-9A-Za-z_-]{35})\b/g, group: 1 },
  { id: 'anthropic-key', description: 'Anthropic API key', regex: /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g, group: 1 },
  {
    id: 'openai-key',
    description: 'OpenAI API key',
    regex: /\b(sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}|sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,})\b/g,
    group: 1,
  },
  { id: 'slack-token', description: 'Slack token', regex: /\b(xox[baprs]-[0-9A-Za-z-]{10,})\b/g, group: 1 },
  { id: 'slack-webhook', description: 'Slack webhook URL', regex: /(https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,})/g, group: 1 },
  { id: 'stripe-secret', description: 'Stripe secret key', regex: /\b((?:sk|rk)_live_[0-9A-Za-z]{20,})\b/g, group: 1 },
  { id: 'twilio-key', description: 'Twilio API key', regex: /\b(SK[0-9a-f]{32})\b/g, group: 1, minEntropy: 3.2 },
  { id: 'sendgrid-key', description: 'SendGrid API key', regex: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/g, group: 1 },
  { id: 'npm-token', description: 'npm access token', regex: /\b(npm_[A-Za-z0-9]{36})\b/g, group: 1 },
  {
    id: 'private-key',
    description: 'Private key block',
    regex: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----)/g,
    group: 1,
  },
  {
    id: 'jwt',
    description: 'JSON Web Token',
    regex: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
    group: 1,
  },
  {
    id: 'db-url-password',
    description: 'Database URL with password',
    regex: /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/]+:[^@\s/]{6,}@[^\s'"]+)/g,
    group: 1,
  },
  {
    id: 'generic-assignment',
    description: 'Hard-coded credential assignment',
    regex: /(?:api[_-]?key|secret|token|passwd|password|client[_-]?secret)["'\s]*[:=]\s*["']([A-Za-z0-9_\-+/=.]{20,})["']/gi,
    group: 1,
    minEntropy: 3.6,
  },
];

/** Files that should never be committed regardless of content. */
export const SENSITIVE_PATHS: { pattern: RegExp; description: string }[] = [
  // 'allow' entries must come first; they short-circuit the checks below.
  { pattern: /(^|\/)\.env\.(example|sample|template)$/, description: 'allow' },
  { pattern: /(^|\/)\.env(\.[A-Za-z0-9_-]+)?$/, description: 'Environment file' },
  { pattern: /\.(pem|p12|pfx|key|keystore|jks|mobileprovision)$/i, description: 'Key or certificate file' },
  { pattern: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, description: 'SSH private key' },
  { pattern: /(^|\/)(credentials|service-account)[^/]*\.json$/i, description: 'Credentials JSON' },
  { pattern: /(^|\/)\.npmrc$/, description: 'npm config (may hold tokens)' },
];

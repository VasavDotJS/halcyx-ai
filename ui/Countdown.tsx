import { useEffect, useState } from 'react';
import { Badge } from './primitives/Controls';

export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Countdown badge for a pending workspace; turns amber under 12h and red under 1h. */
export function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const left = expiresAt - now;
  const tone = left < 3_600_000 ? 'danger' : left < 12 * 3_600_000 ? 'warning' : 'muted';
  return <Badge tone={tone} label={`Erases in ${formatRemaining(left)}`} />;
}

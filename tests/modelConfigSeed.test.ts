import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import bundled from '@/config/models.json';

describe('remote model config has one source of truth', () => {
  it('the newest seeded model_config row equals config/models.json', () => {
    const dir = join(__dirname, '../backend/supabase/migrations');
    const seeds = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .flatMap((sql) => [
        ...sql.matchAll(/insert into public\.model_config \(version, config\)\s*values \('([^']+)', '([\s\S]*?)'::jsonb\)/gi),
      ]);
    expect(seeds.length).toBeGreaterThan(0);
    const [, version, json] = seeds[seeds.length - 1]!;
    expect(version).toBe(bundled.version);
    expect(JSON.parse(json!.replace(/''/g, "'"))).toEqual(bundled);
  });
});

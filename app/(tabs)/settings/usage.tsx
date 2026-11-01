import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { PROVIDERS } from '@/core/providers/registry';
import { evaluateBudget } from '@/core/usage/meter';
import { useReadyServices } from '@/hooks/useServices';
import { useSettings } from '@/state/settings';
import { Card, Input, ListRow, Row, Screen, Section, Segmented, Text, Toggle } from '@/ui/primitives';
import { useTheme } from '@/ui/ThemeProvider';

export default function Usage() {
  const s = useReadyServices();
  const t = useTheme();
  const settings = useSettings();
  const [budget, setBudget] = useState(settings.monthlyBudgetUsd ? String(settings.monthlyBudgetUsd) : '');
  const spend = useQuery({ queryKey: ['spend'], queryFn: () => s.usage.monthSpend(), refetchInterval: 15_000 });
  const providers = useQuery({ queryKey: ['spend-providers'], queryFn: () => s.usage.byProvider() });
  const months = useQuery({ queryKey: ['spend-months'], queryFn: () => s.usage.byMonth(6) });
  const state = evaluateBudget(
    { monthlyBudgetUsd: settings.monthlyBudgetUsd, alertAtPct: settings.budgetAlertPct, hardCap: settings.hardCap },
    spend.data ?? 0,
  );
  const max = Math.max(0.01, ...(months.data ?? []).map((m) => m.usd));

  return (
    <Screen title="Usage & cost">
      <Card className="gap-1">
        <Text variant="caption" tone="muted" className="uppercase tracking-widest">
          This month (estimated)
        </Text>
        <Text variant="display">${(spend.data ?? 0).toFixed(2)}</Text>
        {state.pct !== null ? (
          <>
            <View
              className="h-2 overflow-hidden rounded-full bg-elevated"
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(state.pct) }}
            >
              <View
                className={`h-2 ${state.state === 'capped' ? 'bg-danger' : state.state === 'alert' ? 'bg-warning' : 'bg-accent'}`}
                style={{ width: `${Math.min(100, state.pct)}%` }}
              />
            </View>
            <Text variant="caption" tone={state.state === 'ok' ? 'muted' : state.state === 'alert' ? 'warning' : 'danger'}>
              {Math.round(state.pct)}% of ${settings.monthlyBudgetUsd} {state.state === 'capped' ? '· new tasks are blocked' : ''}
            </Text>
          </>
        ) : null}
        <Text variant="caption" tone="muted">
          Estimates from token counts × list prices. Your provider’s billing page is authoritative.
        </Text>
      </Card>

      <Section title="Last 6 months">
        <View className="h-36 flex-row items-end gap-2 p-4" accessibilityLabel="Monthly spend chart">
          {(months.data ?? []).map((m) => (
            <View key={m.month} className="flex-1 items-center gap-1" accessible accessibilityLabel={`${m.month}: $${m.usd.toFixed(2)}`}>
              <View className="w-full rounded-sm" style={{ height: Math.max(2, (m.usd / max) * 96), backgroundColor: t.colors.accent }} />
              <Text variant="caption" tone="muted">
                {m.month.slice(5)}
              </Text>
            </View>
          ))}
        </View>
      </Section>

      <Section title="By provider (this month)">
        {(providers.data ?? []).length ? (
          providers.data!.map((p, i, all) => (
            <ListRow
              key={p.provider}
              label={PROVIDERS[p.provider].label}
              detail={`${p.tasks} tasks · ${(p.input + p.output).toLocaleString()} tokens`}
              right={<Text variant="label">${p.usd.toFixed(2)}</Text>}
              last={i === all.length - 1}
            />
          ))
        ) : (
          <ListRow label="No usage yet" last />
        )}
      </Section>

      <Section title="Budget">
        <View className="gap-3 p-4">
          <Input
            label="Monthly budget (USD)"
            value={budget}
            keyboardType="decimal-pad"
            placeholder="No budget"
            onChangeText={(v) => {
              setBudget(v);
              const n = Number(v);
              settings.update({ monthlyBudgetUsd: v.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : n });
            }}
          />
          <Text variant="label">Alert at</Text>
          <Segmented
            label="Alert threshold"
            value={String(settings.budgetAlertPct)}
            onChange={(v) => settings.update({ budgetAlertPct: Number(v) })}
            options={[
              { value: '50', label: '50%' },
              { value: '80', label: '80%' },
              { value: '90', label: '90%' },
            ]}
          />
        </View>
        <Toggle
          label="Hard cap"
          detail="Stop running tasks and block new ones at 100%"
          value={settings.hardCap}
          onChange={(v) => settings.update({ hardCap: v })}
          last
        />
      </Section>
      <Row>
        <Text variant="caption" tone="muted">
          Agents also receive a token budget derived from what’s left, so a single task can’t blow through the cap.
        </Text>
      </Row>
    </Screen>
  );
}

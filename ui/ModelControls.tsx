import { Check, ChevronDown, KeyRound } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { estimate } from '@/core/providers/effort';
import type { ModelConfig } from '@/core/providers/modelConfig';
import { PROVIDER_ORDER, PROVIDERS } from '@/core/providers/registry';
import { EFFORT_ORDER, type Effort, type ModelInfo, type ProviderId } from '@/core/types';
import { Badge, Segmented } from './primitives/Controls';
import { Sheet } from './primitives/Sheet';
import { Text } from './primitives/Text';
import { useTheme } from './ThemeProvider';

export type ModelChoice = { provider: ProviderId; model: string; effort: Effort };

const EFFORT_LABEL: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', max: 'Max' };

/** Effort selector with a live estimate of relative cost and speed for the chosen model. */
export function EffortSlider({ model, value, onChange }: { model: ModelInfo; value: Effort; onChange: (e: Effort) => void }) {
  const est = estimate(model, value);
  const options = EFFORT_ORDER.filter((e) => model.efforts.includes(e)).map((e) => ({ value: e, label: EFFORT_LABEL[e] }));
  return (
    <View className="gap-2">
      <Segmented label="Effort" options={options} value={value} onChange={onChange} />
      <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
        {est.approximate ? '≈ ' : '~'}${est.usd.toFixed(2)} per typical task · {est.speed} · {est.relativeCost}× tokens vs medium
      </Text>
    </View>
  );
}

/** Per-conversation model picker across providers; providers without a key link to setup. */
export function ModelPicker({
  config,
  value,
  onChange,
  hasKey,
  onAddKey,
}: {
  config: ModelConfig;
  value: ModelChoice;
  onChange: (v: ModelChoice) => void;
  hasKey: (p: ProviderId) => boolean;
  onAddKey: (p: ProviderId) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const current = config.providers[value.provider].find((m) => m.id === value.model);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Model: ${current?.label ?? value.model}. Change model`}
        onPress={() => setOpen(true)}
        className="min-h-[36px] flex-row items-center gap-1.5 self-start rounded-full border-hairline border-hairline px-3"
      >
        <Text variant="label">{current?.label ?? value.model}</Text>
        <Text variant="caption" tone="muted">
          · {EFFORT_LABEL[value.effort]}
        </Text>
        <ChevronDown size={14} color={t.colors.muted} />
      </Pressable>
      <Sheet visible={open} title="Model" onClose={() => setOpen(false)}>
        {PROVIDER_ORDER.map((p) => (
          <View key={p} className="gap-1">
            <View className="flex-row items-center justify-between px-1">
              <Text variant="caption" tone="muted" className="uppercase tracking-widest">
                {PROVIDERS[p].label}
              </Text>
              {!hasKey(p) ? (
                <Pressable accessibilityRole="button" onPress={() => onAddKey(p)} className="flex-row items-center gap-1 py-1">
                  <KeyRound size={13} color={t.colors.accent} />
                  <Text variant="caption" tone="accent">
                    Add key
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <View className="overflow-hidden rounded-md border-hairline border-hairline">
              {config.providers[p].map((m, i) => {
                const selected = p === value.provider && m.id === value.model;
                const enabled = hasKey(p);
                return (
                  <Pressable
                    key={m.id}
                    disabled={!enabled}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: !enabled }}
                    accessibilityLabel={`${m.label}, ${m.tagline}`}
                    onPress={() => {
                      onChange({ provider: p, model: m.id, effort: m.efforts.includes(value.effort) ? value.effort : m.defaultEffort });
                    }}
                    className={`min-h-[52px] flex-row items-center gap-3 px-3 py-2 ${i ? 'border-t-hairline border-hairline' : ''} ${enabled ? 'active:bg-elevated' : 'opacity-50'}`}
                  >
                    <View className="flex-1">
                      <Text variant="label">{m.label}</Text>
                      <Text variant="caption" tone="muted">
                        {m.tagline} ·{' '}
                        <Text variant="monoSmall" tone="muted">
                          {m.id}
                        </Text>
                      </Text>
                    </View>
                    {p === 'openai' ? <Badge label="no sandbox" /> : null}
                    {selected ? <Check size={18} color={t.colors.accent} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        {current ? (
          <View className="gap-2 pt-2">
            <Text variant="label">Effort</Text>
            <EffortSlider model={current} value={value.effort} onChange={(effort) => onChange({ ...value, effort })} />
          </View>
        ) : null}
      </Sheet>
    </>
  );
}

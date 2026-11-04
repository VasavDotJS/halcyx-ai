import type { SupabaseClient } from '@supabase/supabase-js';
import type { TaskLogEvent } from '@/core/agent/runner';
import { parseModelConfig, type ModelConfig } from '@/core/providers/modelConfig';
import { SYNCED_FIELDS, type Settings } from '@/core/settings/types';
import { TOKEN_BROKER_FUNCTIONS, type TokenBrokerFunction } from '@/core/github/oauth';
import { assertMetadataOnly, containsSecret, MetadataViolation } from './metadata';

export type DeviceRow = {
  id: string;
  device_id: string;
  name: string;
  platform: 'ios' | 'android' | 'web';
  app_version: string;
  last_seen_at: string;
  revoked: boolean;
};

/** Every call validates the payload with assertMetadataOnly before it leaves the device. */
export function createBackendApi(sb: SupabaseClient) {
  const userId = async () => {
    const { data } = await sb.auth.getUser();
    if (!data.user) throw new Error('Not signed in');
    return data.user.id;
  };

  return {
    async logTask(row: TaskLogEvent): Promise<void> {
      assertMetadataOnly('task_log', row);
      const { error } = await sb.from('task_log').upsert({ ...row, user_id: await userId() }, { onConflict: 'user_id,task_id' });
      if (error) throw error;
    },

    async pushSettings(settings: Settings): Promise<void> {
      const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const f of SYNCED_FIELDS) row[f] = settings[f];
      assertMetadataOnly('user_settings', row);
      const { error } = await sb.from('user_settings').upsert({ user_id: await userId(), prefs: row });
      if (error) throw error;
    },

    async pullSettings(): Promise<Partial<Settings> | null> {
      const { data, error } = await sb.from('user_settings').select('prefs').maybeSingle();
      if (error) throw error;
      return (data?.prefs as Partial<Settings> | undefined) ?? null;
    },

    async registerDevice(d: {
      device_id: string;
      name: string;
      platform: 'ios' | 'android' | 'web';
      push_token: string | null;
      app_version: string;
      session_id: string | null;
    }): Promise<void> {
      // A device name that looks like a token (users can name devices anything) is replaced, never stored.
      const name = containsSecret(d.name) ? d.platform : d.name;
      const row = { ...d, name, last_seen_at: new Date().toISOString() };
      assertMetadataOnly('devices', row);
      // The server takes user_id and session_id from the JWT; clients can't write them.
      const { error } = await sb.rpc('register_device', {
        p_device_id: d.device_id,
        p_name: name,
        p_platform: d.platform,
        p_push_token: d.push_token,
        p_app_version: d.app_version,
      });
      if (error) throw error;
    },

    async listDevices(): Promise<DeviceRow[]> {
      const { data, error } = await sb
        .from('devices')
        .select('id, device_id, name, platform, app_version, last_seen_at, revoked')
        .order('last_seen_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as DeviceRow[];
    },

    /** Revokes the device's Supabase session (refresh tokens die immediately). */
    async revokeDevice(id: string): Promise<void> {
      const { error } = await sb.rpc('revoke_device', { p_device: id });
      if (error) throw error;
    },

    async isDeviceRevoked(deviceId: string): Promise<boolean> {
      const { data } = await sb.from('devices').select('revoked').eq('device_id', deviceId).maybeSingle();
      return !!data?.revoked;
    },

    async fetchModelConfig(): Promise<ModelConfig> {
      const { data } = await sb.from('model_config').select('config').order('version', { ascending: false }).limit(1).maybeSingle();
      return parseModelConfig(data?.config ?? null);
    },

    /** Metadata-only cross-device notification (e.g. tablet learns the phone's task finished). */
    async notifyOtherDevices(n: {
      kind: 'task_finished' | 'task_failed' | 'needs_approval' | 'workspace_expiring';
      task_id: string;
      repo: string;
    }) {
      assertMetadataOnly('notify', n);
      await sb.functions.invoke('notify', { body: n });
    },

    async deleteAccount(): Promise<void> {
      const { error } = await sb.functions.invoke('delete-account', { body: {} });
      if (error) throw error;
      await sb.auth.signOut({ scope: 'local' });
    },

    /**
     * Invokes one of the GitHub token-broker functions and unwraps the JSON body. Only those
     * names are accepted: this path deliberately skips assertMetadataOnly because it carries a
     * GitHub token, so it must not become a general escape hatch.
     */
    async invoke<T>(name: TokenBrokerFunction, body: Record<string, unknown>): Promise<T> {
      if (!(TOKEN_BROKER_FUNCTIONS as readonly string[]).includes(name)) throw new MetadataViolation(`Function "${name}" is not allowed`);
      const { data, error } = await sb.functions.invoke(name, { body });
      if (error) throw new Error(error.message);
      return data as T;
    },
  };
}

export type BackendApi = ReturnType<typeof createBackendApi>;

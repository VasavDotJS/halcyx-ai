import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

export type BiometricSupport = { available: boolean; label: string };

export async function biometricSupport(): Promise<BiometricSupport> {
  if (Platform.OS === 'web') return { available: false, label: 'Passcode' };
  const [hasHardware, enrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);
  const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  const label = Platform.OS === 'ios' ? (face ? 'Face ID' : 'Touch ID') : 'Biometrics';
  return { available: hasHardware && enrolled, label };
}

/**
 * Prompts Face ID / Touch ID / BiometricPrompt, falling back to the device passcode.
 * On web (no platform authenticator API here) this resolves true only after an explicit
 * confirm, and callers show the "web is less secure" notice.
 */
export async function authenticate(reason: string): Promise<boolean> {
  if (Platform.OS === 'web') return globalThis.confirm?.(reason) ?? false;
  const { available } = await biometricSupport();
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
    requireConfirmation: true,
    ...(available ? {} : { fallbackLabel: 'Use passcode' }),
  });
  return result.success;
}

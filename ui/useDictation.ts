import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useState } from 'react';

/**
 * On-device dictation. `requiresOnDeviceRecognition` keeps audio on the phone; if the device
 * has no offline model the start call fails and we surface that instead of sending audio away.
 */
export function useDictation(onText: (text: string, final: boolean) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results[0]?.transcript ?? '';
    if (text) onText(text, e.isFinal);
  });
  useSpeechRecognitionEvent('error', (e) => {
    setError(e.message || 'Dictation failed');
    setListening(false);
  });

  const start = useCallback(async () => {
    setError(null);
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      setError('Microphone or speech permission was denied.');
      return;
    }
    if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
      setError('On-device dictation is not available on this device.');
      return;
    }
    ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true, requiresOnDeviceRecognition: true, addsPunctuation: true });
  }, []);

  const stop = useCallback(() => ExpoSpeechRecognitionModule.stop(), []);

  return { listening, error, start, stop };
}

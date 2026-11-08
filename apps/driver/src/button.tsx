import { ActivityIndicator, Pressable, Text } from 'react-native';
import { ui } from '@/theme';

/** Primary button with a busy spinner. */
export function Button({
  label,
  onPress,
  busy,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      style={[ui.button, (busy || disabled) && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={busy || disabled}
      testID={testID}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={ui.buttonText}>{label}</Text>}
    </Pressable>
  );
}

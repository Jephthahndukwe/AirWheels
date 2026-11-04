import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { brand, space, ui } from '@/theme';

/**
 * Driver-only door (ACC-04): activate with an invite, or log in. There is no sign-up.
 */
export default function Welcome() {
  return (
    <View style={[ui.screen, { justifyContent: 'center' }]}>
      <Text style={[ui.h1, { fontSize: 34 }]}>
        <Text style={{ color: brand.coral }}>Air</Text>wheels
      </Text>
      <Text style={[ui.body, { marginBottom: space[7] }]}>Driver app. Invite only.</Text>
      <Link href="/activate" asChild>
        <Pressable style={ui.button} testID="activate">
          <Text style={ui.buttonText}>Activate with invite code</Text>
        </Pressable>
      </Link>
      <Link href="/login" asChild>
        <Pressable style={[ui.button, { backgroundColor: brand.ink, marginTop: space[3] }]} testID="login">
          <Text style={ui.buttonText}>I already have an account</Text>
        </Pressable>
      </Link>
    </View>
  );
}

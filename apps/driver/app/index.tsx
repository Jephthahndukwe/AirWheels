import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { call, getToken, setToken, type Me } from '@/api';
import { brand, space, ui } from '@/theme';

/**
 * Driver-only door (ACC-04): activate with an invite, or sign in. There is no sign-up.
 * With a saved session that still works, go straight to Home.
 */
export default function Welcome() {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    void (async () => {
      if (await getToken()) {
        try {
          await call<Me>('GET', '/v1/driver/me');
          router.replace('/home');
          return;
        } catch {
          await setToken(null);
        }
      }
      setChecking(false);
    })();
  }, []);

  if (checking) {
    return (
      <View style={[ui.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={brand.coral} />
      </View>
    );
  }
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
        <Pressable
          style={[ui.button, { backgroundColor: brand.ink, marginTop: space[3] }]}
          testID="login"
        >
          <Text style={ui.buttonText}>I already have an account</Text>
        </Pressable>
      </Link>
    </View>
  );
}

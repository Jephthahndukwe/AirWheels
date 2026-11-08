import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { initObservability } from '@/observability';
import { brand } from '@/theme';

initObservability();

export default function RootLayout() {
  const [loaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });
  if (!loaded) return null;
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: brand.cloud },
          headerTintColor: brand.ink,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: brand.cloud },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="activate" options={{ title: 'Activate' }} />
        <Stack.Screen name="login" options={{ title: 'Log in' }} />
        <Stack.Screen
          name="home"
          options={{ title: 'Airwheels Driver', headerBackVisible: false }}
        />
      </Stack>
    </>
  );
}

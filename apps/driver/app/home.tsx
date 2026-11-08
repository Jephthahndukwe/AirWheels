import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, Text, View } from 'react-native';
import { ApiError, call, setToken, type Me } from '@/api';
import { brand, space, ui } from '@/theme';

/** How often the app checks its session, so suspension signs the driver out within seconds. */
const SESSION_CHECK_MS = 5_000;

/**
 * Home (PRD 15.1 screens 1 and 2). Location permission is asked only on the first Go on duty
 * (DRV-01). Jobs, offers and earnings connect to the API in M4.
 */
export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const signedOut = useRef(false);

  const endSession = useCallback(async (message?: string) => {
    if (signedOut.current) return;
    signedOut.current = true;
    await setToken(null);
    router.replace('/');
    if (message) Alert.alert('Signed out', message);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setMe(await call<Me>('GET', '/v1/driver/me'));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        await endSession('Your session ended. If you were suspended, call Airwheels ops.');
      }
      // Network errors: keep the screen and try again on the next tick.
    }
  }, [endSession]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), SESSION_CHECK_MS);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh]);

  async function toggleDuty() {
    if (!me) return;
    const next = !me.onDuty;
    if (next) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location needed',
          'Travellers and ops need to see where you are while you are on duty.',
        );
        return;
      }
    }
    setBusy(true);
    try {
      await call('POST', '/v1/driver/duty', { onDuty: next });
      await refresh();
    } catch (e) {
      Alert.alert('Could not change duty', e instanceof ApiError ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await call('POST', '/v1/driver/logout').catch(() => undefined);
    await endSession();
  }

  const onDuty = me?.onDuty ?? false;
  return (
    <View style={ui.screen}>
      <Text style={ui.body}>{me ? `Hello, ${me.firstName}` : 'Loading…'}</Text>
      <Text style={ui.h1}>{onDuty ? 'You are on duty' : 'You are off duty'}</Text>
      <Text style={ui.body}>
        {onDuty ? 'New job offers will appear here.' : 'Go on duty to receive jobs.'}
      </Text>
      <Pressable
        testID="duty-toggle"
        disabled={!me || busy}
        style={[
          ui.button,
          { marginTop: space[5], backgroundColor: onDuty ? brand.ink : brand.coral },
          (!me || busy) && { opacity: 0.5 },
        ]}
        onPress={toggleDuty}
      >
        <Text style={ui.buttonText}>{onDuty ? 'Go off duty' : 'Go on duty'}</Text>
      </Pressable>

      {me?.vehicle && (
        <View style={ui.card}>
          <Text style={[ui.body, { color: brand.ink, fontWeight: '600' }]}>Your car</Text>
          <Text style={ui.body}>
            {me.vehicle.colour} {me.vehicle.brand} {me.vehicle.model} · {me.vehicle.plate}
          </Text>
        </View>
      )}
      <View style={ui.card}>
        <Text style={[ui.body, { color: brand.ink, fontWeight: '600' }]}>Tomorrow&apos;s jobs</Text>
        <Text style={ui.body}>Confirm each job by 9pm. None yet.</Text>
      </View>
      <View style={ui.card}>
        <Text style={[ui.body, { color: brand.ink, fontWeight: '600' }]}>
          Today&apos;s earnings
        </Text>
        <Text style={[ui.h1, { marginTop: space[2] }]}>₦0</Text>
      </View>
      <Pressable onPress={signOut} testID="sign-out">
        <Text style={[ui.body, { marginTop: space[5], textDecorationLine: 'underline' }]}>
          Sign out
        </Text>
      </Pressable>
    </View>
  );
}

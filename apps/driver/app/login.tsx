import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { ApiError, call, deviceId, setToken } from '@/api';
import { brand, space, ui } from '@/theme';
import { Button } from '@/button';

type LoginResult = { otpRequired: false; token: string } | { otpRequired: true; challengeId: string; devCode?: string };

/** Phone and PIN (ACC-06). A new device must also enter an SMS code; other devices are signed out. */
export default function Login() {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; devCode?: string } | null>(null);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const signIn = () =>
    run(async () => {
      const r = await call<LoginResult>('POST', '/v1/driver/login', { phone, pin, deviceId: await deviceId() }, false);
      if (r.otpRequired) setChallenge({ id: r.challengeId, devCode: r.devCode });
      else {
        await setToken(r.token);
        router.replace('/home');
      }
    });

  const verify = () =>
    run(async () => {
      const r = await call<{ token: string }>('POST', '/v1/driver/login/verify', { challengeId: challenge!.id, otp }, false);
      await setToken(r.token);
      router.replace('/home');
    });

  return (
    <ScrollView contentContainerStyle={ui.screen} keyboardShouldPersistTaps="handled">
      {!challenge ? (
        <>
          <TextInput style={ui.input} placeholder="Phone number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} testID="login-phone" />
          <TextInput style={ui.input} placeholder="Six-digit PIN" keyboardType="number-pad" secureTextEntry maxLength={6} value={pin} onChangeText={setPin} testID="login-pin" />
          <Button label="Sign in" onPress={signIn} busy={busy} disabled={phone.length < 7 || pin.length !== 6} testID="login-submit" />
        </>
      ) : (
        <>
          <Text style={ui.body}>This is a new device. Enter the code we texted to {phone}. Your other devices will be signed out.</Text>
          {challenge.devCode && <Text style={[ui.body, { color: brand.coral }]}>Development only: your SMS code is {challenge.devCode}</Text>}
          <View style={{ height: space[4] }} />
          <TextInput style={ui.input} placeholder="SMS code" keyboardType="number-pad" maxLength={8} value={otp} onChangeText={setOtp} testID="login-otp" />
          <Button label="Confirm" onPress={verify} busy={busy} disabled={otp.length < 4} testID="login-otp-submit" />
        </>
      )}
      {error && <Text style={[ui.body, { color: brand.coral, marginTop: space[3] }]}>{error}</Text>}
    </ScrollView>
  );
}

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Button } from '@/button';
import { ApiError, call, deviceId, setToken } from '@/api';
import { brand, space, ui } from '@/theme';

type Step = 'phone' | 'codes' | 'pin';

/**
 * Activation (PRD 5.2 steps 6 to 8): phone number, then the SMS code and the invite code,
 * then a six-digit PIN and the driver terms. The account becomes Active on this device.
 */
export default function Activate() {
  const params = useLocalSearchParams<{ phone?: string }>();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState(params.phone ?? '');
  const [challengeId, setChallengeId] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [otp, setOtp] = useState('');
  const [invite, setInvite] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [firstName, setFirstName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [terms, setTerms] = useState(false);
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

  const sendCode = () =>
    run(async () => {
      const r = await call<{ challengeId: string; devCode?: string }>(
        'POST',
        '/v1/driver/activate/start',
        { phone },
        false,
      );
      setChallengeId(r.challengeId);
      setDevCode(r.devCode);
      setStep('codes');
    });

  const verify = () =>
    run(async () => {
      const r = await call<{ setupToken: string; firstName: string }>(
        'POST',
        '/v1/driver/activate/verify',
        { challengeId, otp, inviteCode: invite },
        false,
      );
      setSetupToken(r.setupToken);
      setFirstName(r.firstName);
      setStep('pin');
    });

  const finish = () =>
    run(async () => {
      if (pin !== pin2) throw new ApiError(400, 'PIN_MISMATCH', 'The two PINs do not match.');
      const r = await call<{ token: string }>(
        'POST',
        '/v1/driver/activate/complete',
        { setupToken, pin, acceptTerms: terms, deviceId: await deviceId() },
        false,
      );
      await setToken(r.token);
      router.replace('/home');
    });

  return (
    <ScrollView contentContainerStyle={ui.screen} keyboardShouldPersistTaps="handled">
      {step === 'phone' && (
        <>
          <Text style={ui.body}>
            Enter the mobile number ops registered for you. We will text you a code.
          </Text>
          <View style={{ height: space[4] }} />
          <TextInput
            style={ui.input}
            placeholder="0801 234 5678"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
            testID="phone"
          />
          <Button
            label="Send code"
            onPress={sendCode}
            busy={busy}
            disabled={phone.length < 7}
            testID="send-code"
          />
        </>
      )}

      {step === 'codes' && (
        <>
          <Text style={ui.body}>
            Enter the code we just texted to {phone}, and the six-digit invite code from your invite
            SMS.
          </Text>
          {devCode && (
            <Text style={[ui.body, { color: brand.coral }]}>
              Development only: your SMS code is {devCode}
            </Text>
          )}
          <View style={{ height: space[4] }} />
          <TextInput
            style={ui.input}
            placeholder="SMS code"
            keyboardType="number-pad"
            maxLength={8}
            value={otp}
            onChangeText={setOtp}
            testID="otp"
          />
          <TextInput
            style={ui.input}
            placeholder="Invite code"
            keyboardType="number-pad"
            maxLength={6}
            value={invite}
            onChangeText={setInvite}
            testID="invite-code"
          />
          <Button
            label="Continue"
            onPress={verify}
            busy={busy}
            disabled={otp.length < 4 || invite.length !== 6}
            testID="activate-submit"
          />
          <Pressable onPress={() => setStep('phone')}>
            <Text style={[ui.body, { marginTop: space[3], textDecorationLine: 'underline' }]}>
              Use a different number or send again
            </Text>
          </Pressable>
        </>
      )}

      {step === 'pin' && (
        <>
          <Text style={ui.h1}>Welcome, {firstName}</Text>
          <Text style={ui.body}>
            Choose a six-digit PIN. You will use it with your phone number to sign in.
          </Text>
          <View style={{ height: space[4] }} />
          <TextInput
            style={ui.input}
            placeholder="New PIN"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={pin}
            onChangeText={setPin}
            testID="pin"
          />
          <TextInput
            style={ui.input}
            placeholder="Type the PIN again"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={pin2}
            onChangeText={setPin2}
            testID="pin2"
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space[4] }}>
            <Switch
              value={terms}
              onValueChange={setTerms}
              trackColor={{ true: brand.coral }}
              testID="terms"
            />
            <Text style={[ui.body, { flex: 1, marginLeft: space[3] }]}>
              I accept the Airwheels driver terms
            </Text>
          </View>
          <Button
            label="Activate my account"
            onPress={finish}
            busy={busy}
            disabled={pin.length !== 6 || !terms}
            testID="pin-submit"
          />
        </>
      )}

      {error && <Text style={[ui.body, { color: brand.coral, marginTop: space[3] }]}>{error}</Text>}
    </ScrollView>
  );
}

import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ui } from '@/theme';

/**
 * Activation (PRD 5.2 steps 6 to 8): phone, OTP, invite code, then a six-digit PIN.
 * The activation endpoint (POST /v1/driver/activate) arrives in M1. This screen holds the flow.
 */
export default function Activate() {
  const [phone, setPhone] = useState('');
  const [invite, setInvite] = useState('');
  return (
    <View style={ui.screen}>
      <Text style={ui.body}>Enter the phone number ops registered and the six-digit invite code from your SMS.</Text>
      <View style={{ height: 16 }} />
      <TextInput style={ui.input} placeholder="+234 801 234 5678" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      <TextInput
        style={ui.input}
        placeholder="Invite code"
        keyboardType="number-pad"
        maxLength={6}
        value={invite}
        onChangeText={setInvite}
        testID="invite-code"
      />
      <Pressable style={ui.button} onPress={() => router.replace('/home')} testID="activate-submit">
        <Text style={ui.buttonText}>Continue</Text>
      </Pressable>
    </View>
  );
}

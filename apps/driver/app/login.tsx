import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ui } from '@/theme';

/** Phone and PIN login (ACC-06). New devices get an OTP step in M1. */
export default function Login() {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  return (
    <View style={ui.screen}>
      <TextInput style={ui.input} placeholder="Phone number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      <TextInput
        style={ui.input}
        placeholder="Six-digit PIN"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        value={pin}
        onChangeText={setPin}
      />
      <Pressable style={ui.button} onPress={() => router.replace('/home')} testID="login-submit">
        <Text style={ui.buttonText}>Log in</Text>
      </Pressable>
    </View>
  );
}

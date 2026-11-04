import * as Location from 'expo-location';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { brand, space, ui } from '@/theme';

/**
 * Home (PRD 15.1 screen 1 and 2). Location permission is asked only on the first Go on duty
 * (DRV-01). Jobs, offers and earnings connect to the API in M4.
 */
export default function Home() {
  const [onDuty, setOnDuty] = useState(false);

  async function toggleDuty() {
    if (!onDuty) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location needed', 'Travellers and ops need to see where you are while you are on duty.');
        return;
      }
    }
    setOnDuty(!onDuty);
  }

  return (
    <View style={ui.screen}>
      <Text style={ui.h1}>{onDuty ? 'You are on duty' : 'You are off duty'}</Text>
      <Text style={ui.body}>{onDuty ? 'New job offers will appear here.' : 'Go on duty to receive jobs.'}</Text>
      <Pressable
        testID="duty-toggle"
        style={[ui.button, { marginTop: space[5], backgroundColor: onDuty ? brand.ink : brand.coral }]}
        onPress={toggleDuty}
      >
        <Text style={ui.buttonText}>{onDuty ? 'Go off duty' : 'Go on duty'}</Text>
      </Pressable>

      <View style={ui.card}>
        <Text style={[ui.body, { color: brand.ink, fontWeight: '600' }]}>Tomorrow&apos;s jobs</Text>
        <Text style={ui.body}>Confirm each job by 9pm. None yet.</Text>
      </View>
      <View style={ui.card}>
        <Text style={[ui.body, { color: brand.ink, fontWeight: '600' }]}>Today&apos;s earnings</Text>
        <Text style={[ui.h1, { marginTop: space[2] }]}>₦0</Text>
      </View>
    </View>
  );
}

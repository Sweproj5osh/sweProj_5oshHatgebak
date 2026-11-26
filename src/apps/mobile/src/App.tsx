import { randomUUID } from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { fetchHandle } from '@sayes/shared-client/fetch-handle';
import { DriverSignInClient, HttpDriverAuthApi } from '@sayes/shared-client/sign-in/index';
import { serverAddress } from './server-address';

/**
 * The one app for every role (ADR-18). The first screen asks who is signing in; the choice only selects the sign-in
 * flow. The server decides who the person is and what they may do (Rule A): the app holds no business rule.
 */
type Role = 'driver' | 'attendant' | 'inspector' | 'committee';

const ROLES: readonly { readonly role: Role; readonly label: string }[] = [
  { role: 'driver', label: 'Driver' },
  { role: 'attendant', label: 'Attendant (sayes)' },
  { role: 'inspector', label: 'Inspector' },
  { role: 'committee', label: 'Committee' },
];

export function App() {
  const [role, setRole] = useState<Role | undefined>(undefined);
  const address = serverAddress();
  return (
    <View style={styles.screen}>
      <StatusBar style="auto" />
      {address === undefined ? (
        <Text style={styles.message}>Set EXPO_PUBLIC_API_URL to the server's https:// address (docs/setup/mobile-app.md).</Text>
      ) : role === undefined ? (
        <RolePicker onChoose={setRole} />
      ) : (
        <SignIn role={role} address={address} onBack={() => setRole(undefined)} />
      )}
    </View>
  );
}

function RolePicker({ onChoose }: { readonly onChoose: (role: Role) => void }) {
  return (
    <View>
      <Text style={styles.title} accessibilityRole="header">
        Who is signing in?
      </Text>
      {ROLES.map(({ role, label }) => (
        <Pressable key={role} style={styles.button} accessibilityRole="button" onPress={() => onChoose(role)}>
          <Text style={styles.buttonText}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function SignIn({ role, address, onBack }: { readonly role: Role; readonly address: string; readonly onBack: () => void }) {
  const client = useMemo(() => new DriverSignInClient({ api: new HttpDriverAuthApi({ handle: fetchHandle(address) }), createRequestId: randomUUID }), [address]);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code' | 'signed in'>('phone');
  const [message, setMessage] = useState<string | undefined>(undefined);

  if (role === 'committee') {
    return (
      <View>
        <Text style={styles.message}>The committee signs in with the phone, the code and a password; that screen comes with task D8.</Text>
        <BackButton onBack={onBack} />
      </View>
    );
  }

  const submitPhone = async () => {
    const answer = await client.submitPhone(phone);
    setMessage(answer.ok ? undefined : answer.error);
    if (answer.ok) setStep('code');
  };
  const submitCode = async () => {
    const answer = await client.submitCode(code);
    setMessage(answer.ok ? undefined : answer.error);
    if (answer.ok) setStep('signed in');
  };

  return (
    <View>
      <Text style={styles.title} accessibilityRole="header">
        {step === 'signed in' ? 'Signed in' : 'Sign in'}
      </Text>
      {step === 'phone' && (
        <>
          <TextInput style={styles.input} accessibilityLabel="Phone number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <Pressable style={styles.button} accessibilityRole="button" onPress={submitPhone}>
            <Text style={styles.buttonText}>Send me a code</Text>
          </Pressable>
        </>
      )}
      {step === 'code' && (
        <>
          <TextInput style={styles.input} accessibilityLabel="One-time code" keyboardType="number-pad" value={code} onChangeText={setCode} />
          <Pressable style={styles.button} accessibilityRole="button" onPress={submitCode}>
            <Text style={styles.buttonText}>Sign in</Text>
          </Pressable>
        </>
      )}
      {step === 'signed in' && <Text style={styles.message}>The screens for your role come with the app tasks D1 to D9.</Text>}
      {message !== undefined && (
        <Text style={styles.message} accessibilityLiveRegion="polite">
          {message}
        </Text>
      )}
      <BackButton onBack={onBack} />
    </View>
  );
}

function BackButton({ onBack }: { readonly onBack: () => void }) {
  return (
    <Pressable style={styles.link} accessibilityRole="button" onPress={onBack}>
      <Text>Choose another role</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 16 },
  button: { backgroundColor: '#1f4e79', borderRadius: 8, padding: 14, marginBottom: 12 },
  buttonText: { color: '#ffffff', fontSize: 18, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#888888', borderRadius: 8, padding: 12, fontSize: 18, marginBottom: 12 },
  message: { fontSize: 16, marginVertical: 12 },
  link: { paddingVertical: 12 },
});

import { brand, radius, space } from '@airwheels/ui';
import { StyleSheet } from 'react-native';

export { brand, radius, space };

export const font = {
  regular: 'PlusJakartaSans_400Regular',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
};

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: brand.cloud, padding: space[5] },
  h1: { fontFamily: font.bold, fontSize: 26, color: brand.ink, marginBottom: space[2] },
  body: { fontFamily: font.regular, fontSize: 15, color: brand.slate },
  card: { backgroundColor: brand.white, borderRadius: radius.lg, padding: space[4], marginTop: space[4] },
  button: { backgroundColor: brand.coral, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  buttonText: { fontFamily: font.semibold, fontSize: 16, color: brand.white },
  input: {
    backgroundColor: brand.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 14,
    fontFamily: font.regular,
    fontSize: 16,
    marginBottom: space[3],
  },
});

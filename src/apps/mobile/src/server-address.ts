/**
 * The HTTPS address of the entry point, set when the app is built or started (`EXPO_PUBLIC_API_URL`, see
 * docs/setup/mobile-app.md). The app never talks plain HTTP (ADR-22).
 */
export function serverAddress(): string | undefined {
  const address = process.env['EXPO_PUBLIC_API_URL'];
  return address === undefined || address === '' ? undefined : address;
}

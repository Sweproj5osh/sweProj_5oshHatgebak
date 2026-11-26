# The app: one Expo app for every role

The app lives at `src/apps/mobile` (ADR-17, ADR-18): an Expo (React Native) project, the npm workspace `@sayes/mobile`.
The first screen asks who is signing in (driver, attendant, inspector, committee); the choice only selects the sign-in
flow. The server decides who the person is and what they may do (Rule A): the app displays and collects, nothing more.

## What is in it
| File | Holds |
|---|---|
| `package.json` | The workspace: `expo`, `react`, `react-native`, `expo-crypto`, `expo-status-bar` (ADR-20), at the versions of Expo SDK 58 |
| `app.json` | The app's name and plugins |
| `metro.config.js` | Expo's bundler defaults, plus the two folders outside the app it bundles: `src/apps/shared-client` and `src/server/shared` |
| `tsconfig.json` | Expo's TypeScript base plus the project's strict options, and the alias `@sayes/shared-client/*` |
| `index.ts`, `src/App.tsx` | The role screen and the phone-and-code sign-in, through the shared client |
| `src/server-address.ts` | The server's HTTPS address, from `EXPO_PUBLIC_API_URL` |

## The shared client
`src/apps/shared-client` is the one HTTP client library. The app imports it as `@sayes/shared-client/...`; the
server-side tests import it by relative path and run it against the real pipeline. `fetch-handle.ts` is the app's
transport: HTTPS only, the method, path, query, headers and JSON body as the server expects them. Request ids come from
`expo-crypto`'s `randomUUID`, because the phone's JavaScript engine has no `crypto.randomUUID`.

## Running it
```bash
npm ci                                              # once, at the repository root: installs the server and the app
cd src/apps/mobile
EXPO_PUBLIC_API_URL=https://<your machine>:3000 npx expo start   # then open it in a simulator, an emulator or Expo Go
npm run typecheck                                   # the app and the shared client, without Node types
npm run bundle                                      # what CI runs: a full Android bundle
```
The server must run over HTTPS (`docs/setup/https.md`), and the phone or simulator must trust its certificate.

## Not built yet
The committee's sign-in with a password (task D8) and every role's own screens (tasks D1 to D9) are Area 5's tasks.
Whether the app gets a web build for committee work on a laptop is an open question (ADR-18).

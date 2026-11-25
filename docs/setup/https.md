# HTTPS

The server answers over HTTPS only (ADR-22): `src/server/main.ts` reads the certificate and its private key from the
PEM files named by `TLS_CERT_PATH` and `TLS_KEY_PATH`, and stops start-up with the variable's name when either is
missing or unreadable. There is no plain-HTTP listener and no redirect.

## Locally
Make a certificate for `localhost` once (developer tools, not project dependencies):

```bash
mkdir -p ~/.sayes-tls
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 365 \
  -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 \
  -keyout ~/.sayes-tls/key.pem -out ~/.sayes-tls/cert.pem
```

Then set `TLS_CERT_PATH=~/.sayes-tls/cert.pem` and `TLS_KEY_PATH=~/.sayes-tls/key.pem` in `.env`, run `npm start`,
and check with `curl --cacert ~/.sayes-tls/cert.pem https://localhost:3000/audit-log` (401 without a token). A tool
such as `mkcert` works too and installs its own local authority, which browsers then trust.

Phones: an iOS simulator or an Android emulator trusts the certificate once it is installed in the simulator; a
physical phone needs the certificate (or the local authority) installed and trusted on the device. Never switch
certificate checks off in the app.

## In tests and continuous integration
Almost every test calls the pipeline in-process, without a socket. The HTTPS adapter test makes a throwaway
certificate with `openssl` (`src/server/test-support/throwaway-certificate.ts`) and trusts exactly that certificate
(`src/server/test-support/https-fetch.ts`). Nothing secret is stored in the repository.

## In production
The server holds its own certificate. If the host terminates TLS at its edge, the edge must re-encrypt to the
server, so plain HTTP never reaches the API. No host is chosen yet (ADR-11).

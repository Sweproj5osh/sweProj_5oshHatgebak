// Planted violation for F13: a public operation that is not one of the two sign-in operations.
export function composeInMemoryRegistry() {
  return {
    all: () => [
      { kind: 'public', name: 'requestSignInCode', method: 'POST', path: '/sign-in/codes', bodySchema: { fields: {} } },
      { kind: 'public', name: 'openTicketWithoutSigningIn', method: 'POST', path: '/bad/tickets', bodySchema: { fields: {} } },
    ],
  };
}

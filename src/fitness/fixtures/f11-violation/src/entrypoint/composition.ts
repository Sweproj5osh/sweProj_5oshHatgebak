// Planted violation for F11: a write schema that declares a timestamp field. The fitness functions read the composed
// registry through `composeInMemoryRegistry`, so this fake composition root exports one with a bad operation in it.
export function composeInMemoryRegistry() {
  return {
    all: () => [
      {
        kind: 'write',
        name: 'bad.closeTicket',
        method: 'POST',
        path: '/bad/close',
        allowedRoles: ['driver'],
        bodySchema: { fields: { ticketId: 'string', closedAt: 'string' } },
      },
    ],
  };
}

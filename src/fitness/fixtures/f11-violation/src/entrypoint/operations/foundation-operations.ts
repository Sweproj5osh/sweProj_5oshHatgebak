// Planted violation for F11: a write schema that declares a timestamp field.
export const foundationOperations = [
  {
    kind: 'write',
    name: 'bad.closeTicket',
    method: 'POST',
    path: '/bad/close',
    allowedRoles: ['driver'],
    bodySchema: { fields: { ticketId: 'string', closedAt: 'string' } },
  },
];

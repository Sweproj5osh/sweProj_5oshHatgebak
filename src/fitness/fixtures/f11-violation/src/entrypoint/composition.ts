// Planted violations for F11: a write schema with a timestamp field, and a localDateTime on a non-committee operation.
// The fitness functions read the composed registry through `composeInMemoryRegistry`, so this fake composition root
// exports one. The chair's closure is allowed and must not be reported.
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
      {
        kind: 'write',
        name: 'bad.driverDeclaresWhenParked',
        method: 'POST',
        path: '/bad/parked',
        allowedRoles: ['driver', 'attendant'],
        bodySchema: { fields: { siteId: 'string', parkedFrom: 'localDateTime' } },
      },
      {
        kind: 'write',
        name: 'good.chairDeclaresClosure',
        method: 'POST',
        path: '/good/closures',
        allowedRoles: ['member', 'chair'],
        bodySchema: { fields: { siteId: 'string', closedFrom: 'localDateTime', closedUntil: 'localDateTime' } },
      },
    ],
  };
}

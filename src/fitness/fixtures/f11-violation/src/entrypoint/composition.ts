// Planted violations for F11: a write schema with a timestamp field, and a localDateTime on a non-committee operation.
// The fitness functions read the composed registry through `composeInMemoryRegistry`, so this fake composition root
// exports one. The committee's closure is allowed and must not be reported, even though its startDate field is named
// like a timestamp: a declared localDateTime is exempt from the name rule (Q7). A numeric startDate is still caught.
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
        name: 'bad.chairDeclaresANumericDate',
        method: 'POST',
        path: '/bad/numeric-date',
        allowedRoles: ['chair'],
        bodySchema: { fields: { siteId: 'string', startDate: 'number' } },
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
        bodySchema: { fields: { siteId: 'string', startDate: 'localDateTime', closedUntil: 'localDateTime' } },
      },
    ],
  };
}

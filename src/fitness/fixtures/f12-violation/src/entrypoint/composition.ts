// Planted violation for F12: write schemas with personal fields and no redaction rule covering them.
export function composeInMemoryRegistry() {
  return {
    all: () => [
      {
        kind: 'write',
        name: 'bad.addCar',
        method: 'POST',
        path: '/bad/cars',
        allowedRoles: ['driver'],
        bodySchema: { fields: { plate: 'string', colour: 'string' } },
      },
      {
        kind: 'write',
        name: 'bad.createPerson',
        method: 'POST',
        path: '/bad/people',
        allowedRoles: ['chair'],
        bodySchema: { fields: { phoneNumber: 'string', displayName: 'string', role: 'string' } },
        audit: { omit: ['phoneNumber'] },
      },
      {
        kind: 'write',
        name: 'good.addCar',
        method: 'POST',
        path: '/good/cars',
        allowedRoles: ['driver'],
        bodySchema: { fields: { plate: 'string' } },
        audit: { replace: { plate: 'carRef' } },
      },
    ],
  };
}

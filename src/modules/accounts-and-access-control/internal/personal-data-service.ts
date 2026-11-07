import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../shared/clock';
import type { PersonId, Role, SiteId } from '../../../shared/identifiers';
import { fail, succeed, type Result } from '../../../shared/result';
import type { TableAccess } from '../../../shared/unit-of-work';
import type {
  Authorization,
  CarRef,
  CarRefusal,
  CreatePersonRefusal,
  ErasureRefusal,
  ErasureReport,
  OwnCar,
  PersonalData,
  PersonCreator,
  PlateReadRefusal,
  PlateReadRequest,
  ResidencyRefusal,
  ServedPlate,
  SiteLocator,
  WalkInCar,
} from '../public';
import { mayCreate, normaliseDisplayName, normalisePhone, normalisePlate } from './domain/person';
import { roleMayReadPlateFor } from './domain/plate-access';
import type { AccessFactsStore, CommitteePasswordStore, PeopleStore, PersonalDataStore, SignInChallengeStore } from './ports';

export interface PersonalDataDependencies {
  /** The committed tables, for every call that does not arrive with a unit of work (see QUESTIONS.md item 23). */
  readonly database: TableAccess;
  readonly people: PeopleStore;
  readonly personalData: PersonalDataStore;
  readonly signInChallenges: SignInChallengeStore;
  readonly committeePasswords: CommitteePasswordStore;
  readonly accessFacts: AccessFactsStore;
  readonly authorization: Authorization;
  readonly siteLocator: SiteLocator;
  readonly clock: Clock;
}

/** A self-registered driver has given no name; the empty string is the one value that cannot be mistaken for one. */
const NO_NAME_GIVEN_YET = '';

/** The operation name the scope rules are asked about for every plate read, whichever route serves the plate. */
export const PLATE_READ_OPERATION = 'personalData.readPlate';
export const REGISTER_RESIDENCY_OPERATION = 'personalData.registerResidency';

/**
 * Creates people and their cars and keeps their personal data apart: roles and statuses go to the people table, names,
 * phones and plates go to the personal-data store, joined only by references (ADR-06, Rule F). A plate leaves this
 * module only through readPlate, which checks the reader; the entry point's logged read writes the one audit entry (P9).
 */
export class PersonalDataService implements PersonalData {
  constructor(private readonly dependencies: PersonalDataDependencies) {}

  async createPerson(
    creator: PersonCreator,
    role: Role,
    phone: string,
    displayName: string,
  ): Promise<Result<PersonId, CreatePersonRefusal>> {
    const creatorRole = creator === 'self registration' ? undefined : (await this.dependencies.people.find(this.database, creator))?.role;
    const permitted = mayCreate(creator, creatorRole, role);
    if (!permitted.ok) {
      return permitted;
    }
    return this.register(role, phone, displayName);
  }

  /** The one-time set-up of the first Chair, run by the system operator, never reachable through a request. */
  async bootstrapChair(phone: string, displayName: string): Promise<Result<PersonId, CreatePersonRefusal>> {
    return this.register('chair', phone, displayName);
  }

  /**
   * A driver who signed in with a phone nobody registered (P3): a person with that phone and no name yet, created inside
   * the sign-in's unit of work. The phone was normalised and found free by the sign-in before the code was confirmed.
   */
  async registerDriverByPhone(transaction: TableAccess, phone: string): Promise<PersonId> {
    const personId = `person-${randomUUID()}`;
    await this.dependencies.people.add(transaction, { personId, role: 'driver', status: 'active', erased: false });
    await this.dependencies.personalData.addDetails(transaction, { personRef: personId, displayName: NO_NAME_GIVEN_YET, phone });
    return personId;
  }

  /** Saving the same plate twice for one driver returns the car already saved. */
  async addCar(driverId: PersonId, plate: string): Promise<Result<CarRef, CarRefusal>> {
    const driver = await this.dependencies.people.find(this.database, driverId);
    if (driver?.role !== 'driver' || driver.erased) {
      return fail('not a driver');
    }
    const normalisedPlate = normalisePlate(plate);
    if (!normalisedPlate.ok) {
      return normalisedPlate;
    }
    const existing = (await this.dependencies.personalData.carsOf(this.database, driverId)).find((car) => car.plate === normalisedPlate.value);
    if (existing !== undefined) {
      return succeed(existing.carRef);
    }
    return succeed(await this.saveCar(this.database, driverId, normalisedPlate.value));
  }

  /**
   * The assisted ticket's car (P15, P28 #32): the car already saved under this plate, or a new car owned by a new
   * walk-in driver, a person with a reference and nothing else, inside the caller's unit of work.
   */
  async findOrCreateCarByPlate(transaction: TableAccess, plate: string): Promise<Result<WalkInCar, 'invalid plate'>> {
    const normalisedPlate = normalisePlate(plate);
    if (!normalisedPlate.ok) {
      return normalisedPlate;
    }
    const existing = await this.dependencies.personalData.carWithPlate(transaction, normalisedPlate.value);
    if (existing !== undefined) {
      return succeed({ carRef: existing.carRef, driverRef: existing.ownerRef });
    }
    const driverRef = `person-${randomUUID()}`;
    await this.dependencies.people.add(transaction, { personId: driverRef, role: 'driver', status: 'active', erased: false });
    return succeed({ carRef: await this.saveCar(transaction, driverRef, normalisedPlate.value), driverRef });
  }

  async carBelongsTo(carRef: CarRef, personId: PersonId): Promise<boolean> {
    return (await this.dependencies.personalData.car(this.database, carRef))?.ownerRef === personId;
  }

  /** The driver's own cars, for the driver's own screen: the person the data is about reading it. */
  async ownCars(driverId: PersonId): Promise<readonly OwnCar[]> {
    const cars = await this.dependencies.personalData.carsOf(this.database, driverId);
    return cars.map(({ carRef, plate }) => ({ carRef, plate }));
  }

  async readPlate(request: PlateReadRequest): Promise<Result<ServedPlate, PlateReadRefusal>> {
    const car = await this.dependencies.personalData.car(this.database, request.carRef);
    if (car === undefined) {
      return fail('not resolvable');
    }
    const readerRole = await this.dependencies.authorization.roleOf(request.reader);
    if (readerRole === undefined || !(await this.mayRead(request, readerRole, car.ownerRef))) {
      return fail('refused');
    }
    const districtId = (await this.dependencies.siteLocator.locateSite(request.siteId))?.districtId;
    return succeed(districtId === undefined ? { plate: car.plate, ownerRef: car.ownerRef } : { plate: car.plate, ownerRef: car.ownerRef, districtId });
  }

  /** A Member of the site's district (or the Chair) registers a car as resident at a site (P28 #31, task A16). */
  async registerResidency(actor: PersonId, carRef: CarRef, siteId: SiteId): Promise<Result<void, ResidencyRefusal>> {
    if (!(await this.dependencies.authorization.may(actor, REGISTER_RESIDENCY_OPERATION, { siteId }))) {
      return fail('not allowed here');
    }
    if ((await this.dependencies.personalData.car(this.database, carRef)) === undefined) {
      return fail('unknown car');
    }
    await this.dependencies.personalData.addResidency(this.database, {
      carRef,
      siteId,
      registeredBy: actor,
      registeredAt: this.dependencies.clock.now().toISOString(),
    });
    return succeed(undefined);
  }

  isResident(carRef: CarRef, siteId: SiteId): Promise<boolean> {
    return this.dependencies.personalData.isResident(this.database, carRef, siteId);
  }

  /**
   * Erasure (task A5, Law 151 of 2020): the person's name, phone, cars, plates and residencies are deleted, with their
   * sign-in code and access facts. The person reference stays, marked erased, so their tickets and audit entries remain
   * whole while nothing resolves to a human being any more. A driver erases themself; the Chair erases anyone but a Chair.
   */
  async erase(actor: PersonId, personId: PersonId): Promise<Result<ErasureReport, ErasureRefusal>> {
    const person = await this.dependencies.people.find(this.database, personId);
    if (person === undefined) {
      return fail('unknown person');
    }
    if (person.erased) {
      return fail('already erased');
    }
    const actorRole = await this.dependencies.authorization.roleOf(actor);
    const erasingThemself = actor === personId && person.role === 'driver';
    if (!erasingThemself && (actorRole !== 'chair' || person.role === 'chair')) {
      return fail('not allowed');
    }
    const personalRows = await this.dependencies.personalData.eraseEverythingAbout(this.database, personId);
    const challengeRows = await this.dependencies.signInChallenges.removeForPerson(this.database, personId);
    const accessFactRows = await this.dependencies.accessFacts.remove(this.database, personId);
    const passwordRows = await this.dependencies.committeePasswords.remove(this.database, personId);
    await this.dependencies.people.markErased(this.database, personId);
    return succeed({
      rowsRemoved: {
        'personal_data.person_details': personalRows.personDetails,
        'personal_data.cars': personalRows.cars,
        'personal_data.residency': personalRows.residency,
        'personal_data.sign_in_challenges': challengeRows,
        'accounts_and_access_control.access_facts': accessFactRows,
        'accounts_and_access_control.committee_passwords': passwordRows,
      },
      rowsMarked: { 'accounts_and_access_control.people': 1 },
    });
  }

  private get database(): TableAccess {
    return this.dependencies.database;
  }

  private async saveCar(tables: TableAccess, ownerRef: PersonId, plate: string): Promise<CarRef> {
    const carRef = `car-${randomUUID()}`;
    await this.dependencies.personalData.addCar(tables, { carRef, ownerRef, plate });
    return carRef;
  }

  private async mayRead(request: PlateReadRequest, readerRole: Role, ownerRef: PersonId): Promise<boolean> {
    if (request.reader === ownerRef) {
      return (await this.dependencies.authorization.liveStatus(request.reader)) === 'active';
    }
    if (!roleMayReadPlateFor(readerRole, request.purpose)) {
      return false;
    }
    return this.dependencies.authorization.may(request.reader, PLATE_READ_OPERATION, { siteId: request.siteId });
  }

  private async register(role: Role, phone: string, displayName: string): Promise<Result<PersonId, CreatePersonRefusal>> {
    const normalisedPhone = normalisePhone(phone);
    if (!normalisedPhone.ok) {
      return normalisedPhone;
    }
    const normalisedName = normaliseDisplayName(displayName);
    if (!normalisedName.ok) {
      return normalisedName;
    }
    if ((await this.dependencies.personalData.personWithPhone(this.database, normalisedPhone.value)) !== undefined) {
      return fail('phone already registered');
    }
    const personId = `person-${randomUUID()}`;
    await this.dependencies.people.add(this.database, { personId, role, status: 'active', erased: false });
    await this.dependencies.personalData.addDetails(this.database, {
      personRef: personId,
      displayName: normalisedName.value,
      phone: normalisedPhone.value,
    });
    return succeed(personId);
  }
}

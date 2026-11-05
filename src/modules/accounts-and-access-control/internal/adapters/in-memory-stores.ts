import type { PersonId } from '../../../../shared/identifiers';
import type { AccountStatus, CarRef } from '../../public';
import type { Person } from '../domain/person';
import type { CarRecord, ErasedRows, PeopleStore, PersonalDataStore, PersonDetails } from '../ports';

/**
 * In-memory stand-ins for this module's tables. They keep their own maps rather than the foundation's
 * InMemoryDatabase because erasure and status changes need to replace and remove rows, which that database's
 * transactions do not offer yet (question 2 for the foundation owner).
 */
export class InMemoryPeopleStore implements PeopleStore {
  private readonly people = new Map<PersonId, Person>();

  async add(person: Person): Promise<void> {
    if (this.people.has(person.personId)) {
      throw new Error(`A person with the reference ${person.personId} already exists`);
    }
    this.people.set(person.personId, person);
  }

  async find(personId: PersonId): Promise<Person | undefined> {
    return this.people.get(personId);
  }

  async setStatus(personId: PersonId, status: AccountStatus): Promise<void> {
    this.people.set(personId, { ...this.existing(personId), status });
  }

  async markErased(personId: PersonId): Promise<void> {
    this.people.set(personId, { ...this.existing(personId), erased: true });
  }

  private existing(personId: PersonId): Person {
    const person = this.people.get(personId);
    if (person === undefined) {
      throw new Error(`No person with the reference ${personId}`);
    }
    return person;
  }
}

export class InMemoryPersonalDataStore implements PersonalDataStore {
  private readonly details = new Map<PersonId, PersonDetails>();
  private readonly cars = new Map<CarRef, CarRecord>();

  async addDetails(details: PersonDetails): Promise<void> {
    this.details.set(details.personRef, details);
  }

  async detailsOf(personRef: PersonId): Promise<PersonDetails | undefined> {
    return this.details.get(personRef);
  }

  async personWithPhone(phone: string): Promise<PersonId | undefined> {
    return [...this.details.values()].find((details) => details.phone === phone)?.personRef;
  }

  async addCar(car: CarRecord): Promise<void> {
    this.cars.set(car.carRef, car);
  }

  async car(carRef: CarRef): Promise<CarRecord | undefined> {
    return this.cars.get(carRef);
  }

  async carsOf(ownerRef: PersonId): Promise<readonly CarRecord[]> {
    return [...this.cars.values()].filter((car) => car.ownerRef === ownerRef);
  }

  async eraseEverythingAbout(personRef: PersonId): Promise<ErasedRows> {
    const personDetails = this.details.delete(personRef) ? 1 : 0;
    const ownedCars = [...this.cars.values()].filter((car) => car.ownerRef === personRef);
    ownedCars.forEach((car) => this.cars.delete(car.carRef));
    return { personDetails, cars: ownedCars.length };
  }
}

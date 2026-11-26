/**
 * Evidence — owner: Teammate D (Area 5). May-fail set.
 * Photos for complaints, road blocks and inspections, behind the PhotoStorage port; a report is saved even when
 * storage is down, with the photo pending.
 */
import type { PhotoId } from '../../shared/identifiers';

export type PhotoState = 'pending upload' | 'stored';

/** Port to the outside photo store (ADR-11). */
export interface PhotoStorage {
  store(photoId: PhotoId, bytes: Uint8Array): Promise<void>;
}

export interface EvidenceStore {
  attachPhoto(bytes: Uint8Array): Promise<PhotoId>;
  photoState(photoId: PhotoId): Promise<PhotoState>;
  uploadPendingPhotos(): Promise<number>;
}

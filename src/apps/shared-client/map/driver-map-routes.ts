/**
 * HTTP route the Driver App uses for the map view: Lino's `sites.nearby`, GET /sites/nearby?latitude=…&longitude=…
 * &radius=… (radius in metres), answering `{ sites: NearbySite[] }` (branch area-a/a10-nearby-sites; not on main yet).
 * The server decides distance order, fee and free-space band; the app only shows what it gets back.
 */
export const DRIVER_MAP_NEARBY_PATH = '/sites/nearby';

export const DRIVER_MAP_NEARBY_OPERATION = 'sites.nearby';

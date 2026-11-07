import { describe, expect, it } from 'vitest';
import { refuse, respond, type HttpResponse } from '../../../shared/operation-contract';
import { MalformedServerAnswerError } from '../server-answer';
import type { ServerRequest } from '../server-call';
import { DriverMapRefusedError } from './driver-map-api';
import { HttpDriverMapApi } from './http-driver-map-api';

/** Lino's `NearbySite` as `sites.nearby` answers it: the fee may be null and the band is his word. */
const SITE_WITH_FEE = { siteId: 'site-1', label: '26 July Street', centre: { latitude: 30.0624, longitude: 31.2195 }, distanceMeters: 120, open: true, firstHourFee: 10, band: 'few' };
const SITE_WITHOUT_FEE = { ...SITE_WITH_FEE, siteId: 'site-2', label: 'Hassan Sabry', distanceMeters: 340, firstHourFee: null, band: 'unknown' };

function recordingApi(answer: HttpResponse) {
  const requests: ServerRequest[] = [];
  const api = new HttpDriverMapApi({
    handle: async (request) => {
      requests.push(request);
      return answer;
    },
    token: () => 'driver-token',
  });
  return { api, requests };
}

describe('D2 data layer: the map reads Lino\'s sites.nearby and displays the band word', () => {
  it('asks GET /sites/nearby with latitude, longitude and radius, and reads { sites } with a nullable fee', async () => {
    const { api, requests } = recordingApi(respond(200, { sites: [SITE_WITH_FEE, SITE_WITHOUT_FEE] }));

    const sites = await api.nearbySites({ latitude: 30.06, longitude: 31.22 }, 1500);

    expect(requests).toEqual([
      { method: 'GET', path: '/sites/nearby', query: { latitude: '30.06', longitude: '31.22', radius: '1500' }, headers: { authorization: 'Bearer driver-token' } },
    ]);
    expect(sites).toEqual([SITE_WITH_FEE, SITE_WITHOUT_FEE]);
  });

  it('passes the band through as the server word and never invents one for a word outside the set', async () => {
    const { api } = recordingApi(respond(200, { sites: [{ ...SITE_WITH_FEE, band: 'plenty' }] }));

    await expect(api.nearbySites({ latitude: 30, longitude: 31 }, 500)).rejects.toBeInstanceOf(MalformedServerAnswerError);
  });

  it('shows the server refusal words for a bad point or radius', async () => {
    const { api } = recordingApi(refuse(400, 'invalid radius'));

    await expect(api.nearbySites({ latitude: 30, longitude: 31 }, -1)).rejects.toEqual(new DriverMapRefusedError('invalid radius'));
  });
});

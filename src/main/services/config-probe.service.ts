/**
 * S10 — configuration probe (thin IO layer).
 *
 * Gives the pure core real HTTP. Read-only by construction: it takes its credentials as
 * arguments and never writes settings or the in-memory API config, so a failed probe
 * cannot damage a configuration that was already working.
 */

import axios from 'axios';
import { API_ENDPOINTS } from './hazu-api/config';
import { buildAuthHeaders } from './hazu-api/api';
import {
  runConfigProbe,
  type ProbeInput,
  type ProbeResult,
  type ReadOutcome,
} from '../../shared/config-probe';

/** Long enough for a slow school connection, short enough that the gate does not look hung. */
const PROBE_TIMEOUT_MS = 15_000;

function resolveEndpoint(environment: string): string {
  return (API_ENDPOINTS as Record<string, string>)[environment] ?? API_ENDPOINTS.swiss;
}

export async function validateApiConfig(input: ProbeInput): Promise<ProbeResult> {
  return runConfigProbe(
    {
      read: async ({ apiKey, environment, rootHazuId }): Promise<ReadOutcome> => {
        try {
          await axios.get(`https://${resolveEndpoint(environment)}/read`, {
            headers: buildAuthHeaders(apiKey),
            params: { id: rootHazuId },
            timeout: PROBE_TIMEOUT_MS,
          });
          return { kind: 'success' };
        } catch (error) {
          const status = (error as { response?: { status?: unknown } })?.response?.status;
          if (typeof status === 'number') return { kind: 'status', status };
          // No response at all: DNS, timeout, refused, offline.
          return { kind: 'network' };
        }
      },
    },
    input
  );
}

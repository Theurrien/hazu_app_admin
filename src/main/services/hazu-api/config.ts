/**
 * Hazu API Configuration
 *
 * Loads configuration from the app's SQLite settings database.
 */

import { HazuEnvironment } from "./interfaces";

export const API_ENDPOINTS = {
  swiss: "europe-west6-hazu-ch.cloudfunctions.net",
  io: "us-central1-blazing-torch-5326.cloudfunctions.net",
  dev: "europe-west6-hazu-ch-dev.cloudfunctions.net",
} as const;

export interface HazuApiConfig {
  apiKey: string;
  environment: HazuEnvironment;
  rootHazuId: string;
  userId?: string;
  userEmail?: string;
  userDisplayName?: string;
}

let currentConfig: HazuApiConfig | null = null;

export function setApiConfig(config: HazuApiConfig): void {
  currentConfig = config;
}

export function getApiConfig(): HazuApiConfig | null {
  return currentConfig;
}

export function getApiKey(): string {
  if (!currentConfig?.apiKey) {
    throw new Error("API key is not configured. Please set it in Settings.");
  }
  return currentConfig.apiKey;
}

export function getApiEndpoint(): string {
  const env = currentConfig?.environment || "swiss";
  return API_ENDPOINTS[env];
}

export function getRootHazuId(): string {
  if (!currentConfig?.rootHazuId) {
    throw new Error("Root Hazu ID is not configured. Please set it in Settings.");
  }
  return currentConfig.rootHazuId;
}

export function isConfigured(): boolean {
  return !!(currentConfig?.apiKey && currentConfig?.rootHazuId);
}

/**
 * Hazu API Configuration
 *
 * This file manages environment configuration and API key selection.
 * Supports three environments: Swiss (production), IO, and Dev.
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Add your API keys to the .env file
 * 3. Change the 'env' variable below to switch environments
 */

import { config } from "dotenv";
import { join } from "path";

// Load environment variables from .env file
config({ path: join(__dirname, '.env') });

// API Keys loaded from environment variables
export const SWISS_API_KEY = process.env.HAZU_API_KEY_SUPPORT_SWISS;
export const IO_API_KEY = process.env.HAZU_API_KEY_SUPPORT_IO;
export const DEV_API_KEY = process.env.HAZU_API_KEY_SUPPORT_DEV;

/**
 * Active Environment Selection
 *
 * Change this value to switch between environments:
 * - "swiss": Production environment (europe-west6-hazu-ch.cloudfunctions.net)
 * - "io": IO environment (us-central1-blazing-torch-5326.cloudfunctions.net)
 * - "dev": Development environment (europe-west6-hazu-ch-dev.cloudfunctions.net)
 */
export const env: "swiss" | "io" | "dev" = "swiss";

// Environment endpoint mapping
export const API_ENDPOINTS = {
  swiss: "europe-west6-hazu-ch.cloudfunctions.net",
  io: "us-central1-blazing-torch-5326.cloudfunctions.net",
  dev: "europe-west6-hazu-ch-dev.cloudfunctions.net",
} as const;

// Helper function to get current API key
export function getApiKey(): string {
  switch (env) {
    case "swiss":
      if (!SWISS_API_KEY) throw new Error("Swiss API key is not defined in environment variables");
      return SWISS_API_KEY;
    case "io":
      if (!IO_API_KEY) throw new Error("IO API key is not defined in environment variables");
      return IO_API_KEY;
    case "dev":
      if (!DEV_API_KEY) throw new Error("Dev API key is not defined in environment variables");
      return DEV_API_KEY;
  }
}

// Helper function to get current API endpoint
export function getApiEndpoint(): string {
  return API_ENDPOINTS[env];
}

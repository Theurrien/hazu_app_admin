/**
 * Test script to explore API user detection methods
 * Run with: npx ts-node examples/test-create-response.ts <HAZU_ID>
 */

import axios from "axios";
import { getApiKey, getApiEndpoint } from "../config";
import { sendApiRequestRemove, sendApiRequestRead } from "../api";

function getAuthHeaders(): Record<string, string> {
  const token = getApiKey();
  return token.length <= 20 ? { token } : { "x-api-key": token };
}

async function testUserDetection() {
  const hazuId = process.argv[2];

  if (!hazuId) {
    console.log("Usage: npx ts-node examples/test-create-response.ts <HAZU_ID>");
    return;
  }

  console.log("Testing create WITHOUT authorId/displayName...");
  console.log("---");

  try {
    // Create with absolutely NO authorId or displayName
    const body = {
      parentId: hazuId,
      type: "item",
      title: "[TEST] API User Detection - DELETE ME",
      privacy: "private",
      // NO authorId
      // NO displayName
    };

    console.log("Request body:", JSON.stringify(body, null, 2));

    const response = await axios.post(
      `https://${getApiEndpoint()}/create`,
      body,
      { headers: getAuthHeaders() }
    );

    console.log("\n=== CREATE RESPONSE ===");
    console.log(JSON.stringify(response.data, null, 2));

    const snapshot = response.data?.snapshot;
    if (snapshot) {
      console.log("\n=== EXTRACTED USER INFO ===");
      console.log("authorId:", snapshot.authorId);
      console.log("displayName:", snapshot.displayName);
      console.log("user:", snapshot.user);

      // Clean up
      console.log("\n=== CLEANING UP ===");
      await sendApiRequestRemove(snapshot.key);
      console.log("Test item deleted.");
    }

  } catch (error: any) {
    console.error("Error:", error.response?.data || error.message);
  }
}

testUserDetection();

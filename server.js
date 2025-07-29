require("dotenv").config();
const express = require("express");
const https = require("https");
const { URL } = require("url");
const { v4: uuidv4 } = require("uuid");
// NEW: Import the Vercel KV client
const { createClient } = require("@vercel/kv");

// --- ENVIRONMENT VARIABLES & CONFIG ---
const {
  ODOO_URL,
  ODOO_DB,
  ODOO_USER,
  ODOO_PASSWORD,
  CX_API_KEY,
  CX_API_SECRET,
  CRON_SECRET, // NEW: For securing the cron endpoint
  PORT = 3000,
  // NEW: Vercel KV environment variables will be automatically available
  KV_URL,
  KV_REST_API_URL,
  KV_REST_API_TOKEN,
  KV_REST_API_READ_ONLY_TOKEN,
} = process.env;

// --- INITIALIZATION ---
const app = express();
app.use(express.json());

// NEW: Initialize the Vercel KV client
const kv = createClient({
  url: KV_REST_API_URL,
  token: KV_REST_API_TOKEN,
});

// This configuration remains the same
const employeeConfig = {
  1: { odoo_id: 148, name: "Nezar Saab Abouhamdan" },
  2: { odoo_id: 149, name: "Abdulrazak Mansour Sabagh" },
  3: { odoo_id: 202, name: "Ahmad Almoustafa" },
  4: { odoo_id: 18, name: "Ahmed Mohamed Adel Hassanin" },
  5: { odoo_id: 188, name: "Arman Tupas" },
  6: { odoo_id: 190, name: "Batoul Al Asaad" },
  7: { odoo_id: 187, name: "Danilo Labbao" },
  8: { odoo_id: 196, name: "Hind Tarhzouti" },
  9: { odoo_id: 150, name: "Jonin Bernadette Belmes Garcia" },
  10: { odoo_id: 153, name: "Khaled Majid" },
  11: { odoo_id: 14, name: "Laman Abdulnour" },
  12: { odoo_id: 156, name: "Maha Alitani" },
  13: { odoo_id: 158, name: "Souad Ismail" },
  14: { odoo_id: 159, name: "Tarig Ali Humaida Ali" },
  15: { odoo_id: 199, name: "Mahbubur Siam" },
  16: { odoo_id: 184, name: "Wamidh Jassem" },
  17: { odoo_id: 152, name: "abunas" },
  18: { odoo_id: 185, name: "Muhammad Hamza" },
};

// REMOVED: The in-memory `employeeRecords` object is no longer used. State is now in Vercel KV.

// ========================================================
// 1️⃣ CONFIGURATION VALIDATION & HELPERS
// ========================================================

function validateConfig() {
  const required = [
    "ODOO_URL",
    "ODOO_DB",
    "ODOO_USER",
    "ODOO_PASSWORD",
    "CX_API_KEY",
    "CX_API_SECRET",
    "CRON_SECRET", // Ensure the cron secret is set
    "KV_REST_API_URL", // Ensure Vercel KV is configured
    "KV_REST_API_TOKEN",
  ];
  if (!required.every((key) => process.env[key])) {
    const missing = required.filter((key) => !process.env[key]);
    console.error("❌ Missing environment variables:", missing.join(", "));
    // In a serverless environment, throwing an error is better than exiting the process
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}

// This helper can remain the same
const lastRequestTimestamps = { crosschex: 0 };
async function makeRequest(host, path, body, headers = {}) {
  // ... (Your makeRequest function is fine, no changes needed here)
  if (host.includes("crosschexcloud.com")) {
    const now = Date.now();
    const timeSinceLast = now - lastRequestTimestamps.crosschex;
    if (timeSinceLast < 31000) {
      const waitTime = 31000 - timeSinceLast;
      console.log(`⏳ Waiting ${waitTime / 1000}s for CrossChex rate limit`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    lastRequestTimestamps.crosschex = Date.now();
  }
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port: 443,
      path: path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...headers,
      },
      rejectUnauthorized: false,
      timeout: 20000,
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ========================================================
// 2️⃣ ODOO & CROSSCHEX API FUNCTIONS
// ========================================================

// These functions are mostly stateless and can remain the same
// REMOVED: The global `odooSession` variable to make it fully stateless.
// It will now be managed within the scope of a single `syncAll` run.

let odooSession = { id: null, uid: null }; // Will be reset on each invocation
async function odooAuthenticate() {
  const host = new URL(ODOO_URL).hostname;
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "call",
    id: uuidv4(),
    params: {
      service: "common",
      method: "login",
      args: [ODOO_DB, ODOO_USER, ODOO_PASSWORD],
    },
  });
  const { data } = await makeRequest(host, "/jsonrpc", payload);
  const json = JSON.parse(data);
  if (json.result) {
    odooSession = { uid: json.result, id: json.session_id || uuidv4() };
    console.log("✅ Odoo authenticated for this run");
  } else {
    throw new Error("Odoo authentication failed: " + JSON.stringify(json));
  }
}

function formatForOdoo(datetimeStr) {
  const date = new Date(datetimeStr);
  return date.toISOString().replace("T", " ").substring(0, 19);
}

async function odooRpcCall(model, method, args = [], kwargs = {}) {
  // Authentication is now checked on every call if needed
  if (!odooSession.uid) await odooAuthenticate();
  const host = new URL(ODOO_URL).hostname;
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "call",
    id: uuidv4(),
    params: {
      service: "object",
      method: "execute_kw",
      args: [
        ODOO_DB,
        odooSession.uid,
        ODOO_PASSWORD,
        model,
        method,
        args,
        kwargs,
      ],
    },
  });
  const { data } = await makeRequest(host, "/jsonrpc", payload, {
    Cookie: `session_id=${odooSession.id}`,
  });
  const json = JSON.parse(data);
  if (json.error) {
    const errorMessage = json.error.data?.message || json.error.message;
    console.error(`❌ Odoo RPC Error (${model}.${method}):`, errorMessage);
    // If auth error, reset session to force re-auth next time
    if (errorMessage.includes("Session expired"))
      odooSession = { id: null, uid: null };
    throw new Error(errorMessage);
  }
  return json.result;
}

// CX functions are fine as they are. They fetch a token each run if needed.
let cxToken = "";
let cxTokenExpires = null;
async function getCXToken() {
  /* ... No changes needed ... */
}
async function fetchCXRecords(startTime, endTime) {
  /* ... No changes needed ... */
}

// Copy your existing `getCXToken` and `fetchCXRecords` functions here. They do not need to be changed.
async function getCXToken() {
  if (cxToken && cxTokenExpires && new Date() < cxTokenExpires) return;
  console.log("🔑 Renewing CX token");
  const body = JSON.stringify({
    header: {
      nameSpace: "authorize.token",
      nameAction: "token",
      version: "1.0",
      requestId: uuidv4(),
      timestamp: new Date().toISOString(),
    },
    payload: { api_key: CX_API_KEY, api_secret: CX_API_SECRET },
  });
  const { data } = await makeRequest("api.eu.crosschexcloud.com", "/", body);
  const json = JSON.parse(data);
  if (json.payload?.token) {
    cxToken = json.payload.token;
    cxTokenExpires = new Date(json.payload.expires);
    console.log("✅ CX Token valid until:", cxTokenExpires.toISOString());
  } else {
    throw new Error("CX authentication failed: " + JSON.stringify(json));
  }
}

async function fetchCXRecords(startTime, endTime) {
  console.log(`🔍 Fetching CX records from ${startTime} to ${endTime}`);
  await getCXToken();
  const allRecords = [];
  for (let page = 1, hasMore = true; hasMore; page++) {
    const body = JSON.stringify({
      header: {
        nameSpace: "attendance.record",
        nameAction: "getrecord",
        version: "1.0",
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
      authorize: { type: "token", token: cxToken },
      payload: {
        begin_time: startTime,
        end_time: endTime,
        page,
        per_page: 200,
      },
    });
    const { data } = await makeRequest("api.eu.crosschexcloud.com", "/", body);
    const json = JSON.parse(data);
    if (json.payload?.list?.length > 0) {
      allRecords.push(...json.payload.list);
      hasMore = json.payload.list.length === 200;
    } else {
      hasMore = false;
    }
  }
  console.log(`✅ Total records fetched: ${allRecords.length}`);
  return allRecords;
}

// ========================================================
// 3️⃣ REWRITTEN CORE SYNC LOGIC (STATELESS)
// ========================================================

/**
 * Processes and syncs new records for a single employee in a stateless way.
 */
async function processAndSyncEmployee(workno, newRawRecords) {
  const employeeInfo = employeeConfig[workno];
  const odooEmployeeId = employeeInfo.odoo_id;
  const kvKey = `records:${workno}`;

  // 1. Fetch previously synced record UUIDs from Vercel KV
  const previouslySyncedUuids = await kv.smembers(kvKey);
  const syncedUuidsSet = new Set(previouslySyncedUuids);

  // 2. Filter out records that have already been synced
  const unsyncedRecords = newRawRecords.filter(
    (r) => !syncedUuidsSet.has(r.uuid)
  );

  if (unsyncedRecords.length === 0) {
    console.log(`[${employeeInfo.name}] No new records to sync.`);
    return;
  }

  // Sort records by time to ensure correct check-in/out order
  unsyncedRecords.sort((a, b) => new Date(a.checktime) - new Date(b.checktime));
  console.log(
    `[${employeeInfo.name}] Found ${unsyncedRecords.length} new records to sync.`
  );

  // 3. Process each new record sequentially
  for (const record of unsyncedRecords) {
    try {
      // For each punch, determine if it's a check-in or check-out by querying Odoo's current state
      const openAttendances = await odooRpcCall(
        "hr.attendance",
        "search_read",
        [
          [
            ["employee_id", "=", odooEmployeeId],
            ["check_out", "=", false],
          ],
        ],
        { fields: ["id"], limit: 1, order: "check_in desc" }
      );

      if (openAttendances.length > 0) {
        // There's an open check-in, so this must be a check-out
        const attendanceIdToUpdate = openAttendances[0].id;
        console.log(
          `  -> [${employeeInfo.name}] CHECK-OUT at ${record.checktime} for attendance ID ${attendanceIdToUpdate}`
        );
        await odooRpcCall("hr.attendance", "write", [
          [attendanceIdToUpdate],
          { check_out: formatForOdoo(record.checktime) },
        ]);
      } else {
        // No open check-in, so this must be a new check-in
        console.log(
          `  -> [${employeeInfo.name}] CHECK-IN at ${record.checktime}`
        );
        await odooRpcCall("hr.attendance", "create", [
          [
            {
              employee_id: odooEmployeeId,
              check_in: formatForOdoo(record.checktime),
            },
          ],
        ]);
      }

      // 4. On successful sync to Odoo, add the UUID to our KV store
      await kv.sadd(kvKey, record.uuid);
      console.log(`     ✅ Successfully synced record ${record.uuid}`);
    } catch (error) {
      console.error(
        `     ❌ FAILED to sync record ${record.uuid} for ${employeeInfo.name}: ${error.message}`
      );
      // IMPORTANT: Stop processing this employee on the first error to maintain order.
      // The next cron run will re-attempt this record since its UUID was not saved to KV.
      return; // Exit this function for this employee
    }
  }
}

/**
 * Main function called by the cron job.
 */
async function syncAll() {
  console.log("\n🔄 Starting synchronization cycle...");
  odooSession = { id: null, uid: null }; // Reset Odoo session for each run

  try {
    const now = new Date();
    // Fetch a window of records. E.g., the last 24 hours to be safe.
    const startTime = new Date(
      now.getTime() - 24 * 60 * 60 * 1000
    ).toISOString();
    const endTime = now.toISOString();

    const allRawRecords = await fetchCXRecords(startTime, endTime);

    // Group records by employee
    const rawRecordsByEmployee = {};
    for (const rawRecord of allRawRecords) {
      const workno = rawRecord.employee.workno;
      if (employeeConfig[workno]) {
        if (!rawRecordsByEmployee[workno]) rawRecordsByEmployee[workno] = [];
        rawRecordsByEmployee[workno].push(rawRecord);
      }
    }

    // Process each employee one by one
    for (const workno in employeeConfig) {
      if (rawRecordsByEmployee[workno]) {
        await processAndSyncEmployee(workno, rawRecordsByEmployee[workno]);
      }
    }

    console.log("✅ Synchronization cycle finished.");
  } catch (error) {
    // This catches major errors like failing to fetch from CrossChex or Odoo auth
    console.error(
      "❌ A major error occurred in the sync cycle:",
      error.message
    );
    // Throw error to signal failure to Vercel
    throw error;
  }
}

// ========================================================
// 4️⃣ API ENDPOINTS & SERVER STARTUP
// ========================================================

// REMOVED: All `setInterval` and automatic scheduling logic.

// A simple health-check endpoint
app.get("/", (req, res) => res.json({ status: "running" }));

// NEW: The endpoint that Vercel Cron Jobs will call
app.post("/api/cron", async (req, res) => {
  // Secure the endpoint
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    await syncAll();
    res.status(200).json({ success: true, message: "Sync finished." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Start the server
try {
  validateConfig();
  app.listen(PORT, () => {
    console.log(`🚀 Attendance Sync API ready and listening on port ${PORT}`);
    console.log("Waiting for Vercel Cron Job triggers on /api/cron");
  });
} catch (error) {
  console.error("Failed to start server:", error.message);
}

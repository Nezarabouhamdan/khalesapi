require("dotenv").config();
const express = require("express");
const https = require("https");
const { URL } = require("url");
const { v4: uuidv4 } = require("uuid");
const {
  zonedTimeToUtc,
  startOfDay: startOfDayTz,
  endOfDay: endOfDayTz,
} = require("date-fns-tz");

const {
  ODOO_URL,
  ODOO_DB,
  ODOO_USER,
  ODOO_PASSWORD,
  CX_API_KEY,
  CX_API_SECRET,
  PORT = 3000,
} = process.env;

const app = express();
app.use(express.json());

// ========================================================
// 1️⃣ EMPLOYEE & RECORD MANAGEMENT
// ========================================================

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
// CRITICAL: This object maintains the state of all punches for each employee.
const employeeRecords = {};

function initializeEmployeeRecords() {
  for (const workno in employeeConfig) {
    employeeRecords[workno] = {
      // records will be an array of { uuid: string, checktime: string, type: string, odoo_synced: boolean }
      records: [],
    };
  }
}

// ========================================================
// 2️⃣ CONFIGURATION VALIDATION & HELPERS
// ========================================================

function validateConfig() {
  const required = [
    "ODOO_URL",
    "ODOO_DB",
    "ODOO_USER",
    "ODOO_PASSWORD",
    "CX_API_KEY",
    "CX_API_SECRET",
  ];
  if (!required.every((key) => process.env[key])) {
    console.error(
      "❌ Missing environment variables:",
      required.filter((key) => !process.env[key]).join(", ")
    );
    process.exit(1);
  }
}

const lastRequestTimestamps = { crosschex: 0 };
async function makeRequest(host, path, body, headers = {}) {
  // Rate limiting for CrossChex
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
// 3️⃣ ODOO API FUNCTIONS
// ========================================================

let odooSession = { id: null, uid: null };

async function odooAuthenticate() {
  if (odooSession.uid && odooSession.id) return; // Avoid re-authenticating if already done
  const host = new URL(ODOO_URL).hostname;
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "common",
      method: "login",
      args: [ODOO_DB, ODOO_USER, ODOO_PASSWORD],
    },
    id: uuidv4(),
  });
  const { data } = await makeRequest(host, "/jsonrpc", payload);
  const json = JSON.parse(data);
  if (json.result) {
    odooSession = { uid: json.result, id: json.session_id || uuidv4() };
    console.log("✅ Odoo authenticated");
  } else {
    throw new Error("Odoo authentication failed: " + JSON.stringify(json));
  }
}

function formatForOdoo(datetimeStr) {
  const date = new Date(datetimeStr);
  return date.toISOString().replace("T", " ").substring(0, 19);
}

async function odooRpcCall(model, method, args = [], kwargs = {}) {
  await odooAuthenticate();
  const host = new URL(ODOO_URL).hostname;
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "call",
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
    id: uuidv4(),
  });
  const { data } = await makeRequest(host, "/jsonrpc", payload, {
    Cookie: `session_id=${odooSession.id}`,
  });
  const json = JSON.parse(data);
  if (json.error) {
    console.error(
      `❌ Odoo RPC Error (${model}.${method}):`,
      json.error.data?.message || json.error.message
    );
    throw new Error(
      json.error.data?.message || `Odoo RPC Error on ${model}.${method}`
    );
  }
  return json.result;
}

// ========================================================
// 4️⃣ CROSSCHEX API FUNCTIONS
// ========================================================

let cxToken = "";
let cxTokenExpires = null;
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
// 5️⃣ CORE SYNC LOGIC
// ========================================================

function processNewRecords(workno, newRawRecords) {
  const employee = employeeRecords[workno];
  const existingUuids = new Set(employee.records.map((r) => r.uuid));

  const trulyNewRecords = newRawRecords.filter(
    (r) => !existingUuids.has(r.uuid)
  );
  if (trulyNewRecords.length === 0) {
    return false; // No new records
  }

  console.log(
    `[${employeeConfig[workno].name}] Storing ${trulyNewRecords.length} new punch records.`
  );

  trulyNewRecords.forEach((rawRecord) => {
    employee.records.push({
      uuid: rawRecord.uuid,
      checktime: rawRecord.checktime,
      odoo_synced: false,
    });
  });

  // Sort ALL records to determine the correct in/out sequence for the day
  employee.records.sort(
    (a, b) => new Date(a.checktime) - new Date(b.checktime)
  );

  // Assign type (in/out) based on the full historical sequence
  employee.records.forEach((record, index) => {
    record.type = index % 2 === 0 ? "check_in" : "check_out";
  });

  return true; // Indicates there are new records to process
}

async function syncEmployeeToOdoo(workno) {
  const employee = employeeRecords[workno];
  const odooEmployeeId = employeeConfig[workno].odoo_id;
  const unsyncedRecords = employee.records.filter((r) => !r.odoo_synced);

  if (unsyncedRecords.length === 0) {
    console.log(
      `[${employeeConfig[workno].name}] No new records to sync to Odoo.`
    );
    return;
  }

  console.log(
    `[${employeeConfig[workno].name}] Syncing ${unsyncedRecords.length} records to Odoo...`
  );

  for (const record of unsyncedRecords) {
    try {
      if (record.type === "check_in") {
        console.log(`  -> Type: CHECK-IN. Time: ${record.checktime}`);
        await odooRpcCall("hr.attendance", "create", [
          [
            {
              employee_id: odooEmployeeId,
              check_in: formatForOdoo(record.checktime),
            },
          ],
        ]);
      } else {
        // 'check_out'
        console.log(`  -> Type: CHECK-OUT. Time: ${record.checktime}`);
        // Find the last open attendance record for this employee to update it
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

        if (openAttendances.length === 0) {
          throw new Error(
            `Cannot find an open attendance for employee ${odooEmployeeId} to check-out.`
          );
        }
        const attendanceIdToUpdate = openAttendances[0].id;
        console.log(
          `     Found open attendance ID: ${attendanceIdToUpdate}. Updating...`
        );
        await odooRpcCall("hr.attendance", "write", [
          [attendanceIdToUpdate],
          { check_out: formatForOdoo(record.checktime) },
        ]);
      }
      record.odoo_synced = true; // Mark as synced ONLY on success
      console.log(`     ✅ Successfully synced record ${record.uuid}`);
    } catch (error) {
      console.error(
        `     ❌ FAILED to sync record ${record.uuid}: ${error.message}`
      );
      // IMPORTANT: Stop processing this employee on the first error to maintain the correct sequence.
      // The next run will try this same record again.
      return;
    }
  }
}

async function syncAll() {
  try {
    // Define the target timezone
    const timeZone = "Asia/Dubai";

    // Get the current date/time in a way that's aware of the target timezone
    const nowInDubai = zonedTimeToUtc(new Date(), timeZone);

    // Calculate the start and end of the DAY in the Dubai timezone
    const startOfDubaiDay = startOfDayTz(nowInDubai, { timeZone });
    const endOfDubaiDay = endOfDayTz(nowInDubai, { timeZone });

    // Convert to ISO string format for the API call
    const startTime = startOfDubaiDay.toISOString();
    const endTime = endOfDubaiDay.toISOString();

    // The rest of your function remains the same
    const allRawRecords = await fetchCXRecords(startTime, endTime);

    // Group all fetched records by employee
    const rawRecordsByEmployee = {};
    for (const rawRecord of allRawRecords) {
      const workno = rawRecord.employee.workno;
      if (employeeConfig[workno]) {
        if (!rawRecordsByEmployee[workno]) rawRecordsByEmployee[workno] = [];
        rawRecordsByEmployee[workno].push(rawRecord);
      }
    }

    // Process and sync for each configured employee
    for (const workno in employeeConfig) {
      if (rawRecordsByEmployee[workno]) {
        const hasNew = processNewRecords(workno, rawRecordsByEmployee[workno]);
        if (hasNew) {
          await syncEmployeeToOdoo(workno);
        }
      }
    }
  } catch (error) {
    // Catch errors from fetching or auth, not from individual syncs
    console.error(
      "❌ A major error occurred in the sync cycle:",
      error.message
    );
  }
}
// ========================================================
// 6️⃣ SCHEDULING & SERVER STARTUP
// ========================================================

// UPDATED: Changed from minutes to seconds for more granular control
const SYNC_INTERVAL_SECONDS = parseInt(process.env.SYNC_INTERVAL_SECONDS) || 30;
let syncInterval = null;
let isSyncing = false; // A flag to prevent syncs from overlapping

async function performAutomaticSync() {
  if (isSyncing) {
    console.log("Sync already in progress. Skipping this run.");
    return;
  }
  isSyncing = true;
  console.log("\n🔄 Starting automatic synchronization...");
  try {
    await syncAll();
  } catch (e) {
    console.error("Critical failure during sync execution", e);
  }
  console.log("✅ Automatic sync cycle finished.");
  isSyncing = false;
}

function startAutomaticSync() {
  // UPDATED: Log message reflects seconds
  console.log(
    `⏰ Automatic sync will start now, then run every ${SYNC_INTERVAL_SECONDS} seconds`
  );
  performAutomaticSync(); // Run immediately on start
  // UPDATED: Calculation is now SYNC_INTERVAL_SECONDS * 1000
  syncInterval = setInterval(
    performAutomaticSync,
    SYNC_INTERVAL_SECONDS * 1000
  );
}

// API endpoint to manually trigger a sync
app.post("/trigger-sync", async (req, res) => {
  console.log("Manual sync triggered via API.");
  await performAutomaticSync();
  res.json({ success: true, message: "Manual sync finished." });
});

// A simple health-check endpoint
app.get("/", (req, res) => res.json({ status: "running" }));

// Graceful shutdown
process.on("SIGINT", () => {
  if (syncInterval) clearInterval(syncInterval);
  console.log("\n🛑 Shutting down gracefully...");
  process.exit(0);
});

validateConfig();
initializeEmployeeRecords();
app.listen(PORT, () => {
  console.log(`🚀 Attendance Sync API running on port ${PORT}`);
  startAutomaticSync();
});

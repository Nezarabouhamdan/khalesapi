require("dotenv").config();
const express = require("express");
const https = require("https");
const { URL } = require("url");
const { v4: uuidv4 } = require("uuid");

// Use dayjs for robust time and timezone handling
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

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
// 1️⃣ EMPLOYEE CONFIGURATION
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

// ========================================================
// 2️⃣ HELPER & API FUNCTIONS (Odoo, CrossChex)
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
  if (host.includes("crosschexcloud.com")) {
    const now = Date.now();
    const timeSinceLast = now - lastRequestTimestamps.crosschex;
    if (timeSinceLast < 5000) {
      // 5 second buffer
      const waitTime = 5000 - timeSinceLast;
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

let odooSession = { id: null, uid: null };
async function odooAuthenticate() {
  if (odooSession.uid && odooSession.id) return;
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

function formatForOdoo(datetime) {
  return dayjs(datetime).utc().format("YYYY-MM-DD HH:mm:ss");
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
// 3️⃣ CORE SYNC LOGIC (STATELESS & RELIABLE)
// ========================================================
async function syncEmployee(workno, punches, startOfDay, endOfDay) {
  const { odoo_id: employeeId, name: employeeName } = employeeConfig[workno];
  console.log(`[${employeeName}] Reconciling ${punches.length} punches...`);

  // 1. Get Odoo records for this employee for the current day
  const odooAttendances = await odooRpcCall(
    "hr.attendance",
    "search_read",
    [
      [
        ["employee_id", "=", employeeId],
        ["check_in", ">=", formatForOdoo(startOfDay)],
        ["check_in", "<=", formatForOdoo(endOfDay)],
      ],
    ],
    { fields: ["id", "check_in", "check_out"], order: "check_in asc" }
  );

  // 2. Loop through the punches in pairs (check-in, check-out)
  for (let i = 0; i < punches.length; i += 2) {
    const checkInPunch = punches[i];
    const checkOutPunch = punches[i + 1]; // This will be undefined if there's an odd number of punches

    const odooRecord = odooAttendances[i / 2];

    if (!odooRecord) {
      // If there's no corresponding record in Odoo, we need to create it.
      console.log(
        `  -> Creating new Odoo record for check-in at ${checkInPunch.checktime}`
      );
      const newRecordPayload = {
        employee_id: employeeId,
        check_in: formatForOdoo(checkInPunch.checktime),
      };
      if (checkOutPunch) {
        // If there's a matching check-out punch, add it to the new record right away.
        newRecordPayload.check_out = formatForOdoo(checkOutPunch.checktime);
        console.log(`     ... with check-out at ${checkOutPunch.checktime}`);
      }
      await odooRpcCall("hr.attendance", "create", [newRecordPayload]);
    } else {
      // A record already exists in Odoo. We only need to act if there's a new check-out.
      if (checkOutPunch && !odooRecord.check_out) {
        // If there is a checkout punch and the Odoo record is still open, update it.
        console.log(
          `  -> Updating Odoo record [${odooRecord.id}] with check-out at ${checkOutPunch.checktime}`
        );
        await odooRpcCall("hr.attendance", "write", [
          [odooRecord.id],
          { check_out: formatForOdoo(checkOutPunch.checktime) },
        ]);
      }
    }
  }
}

async function syncAll() {
  try {
    const timeZone = "Asia/Dubai";
    const nowInDubai = dayjs().tz(timeZone);
    const startOfDay = nowInDubai.startOf("day");
    const endOfDay = nowInDubai.endOf("day");

    // Fetch all records within the correct Dubai workday
    let allCxRecords = await fetchCXRecords(
      startOfDay.toISOString(),
      endOfDay.toISOString()
    );

    // ▼▼▼ CRITICAL REQUIREMENT: Manually subtract 2 hours from every punch timestamp ▼▼▼
    if (allCxRecords.length > 0) {
      console.log(
        `- Adjusting ${allCxRecords.length} raw records by -2 hours...`
      );
      allCxRecords = allCxRecords.map((record) => {
        const originalTime = dayjs(record.checktime);
        const adjustedTime = originalTime.subtract(2, "hour");
        // Overwrite the original checktime with the adjusted one for all subsequent logic.
        record.checktime = adjustedTime.toISOString();
        return record;
      });
    }
    // ▲▲▲ END OF ADJUSTMENT ▲▲▲

    // Group the (now adjusted) punches by employee
    const punchesByEmployee = {};
    for (const record of allCxRecords) {
      const workno = record.employee.workno;
      if (employeeConfig[workno]) {
        if (!punchesByEmployee[workno]) punchesByEmployee[workno] = [];
        punchesByEmployee[workno].push(record);
      }
    }

    // Process each employee's punches for the day
    for (const workno in punchesByEmployee) {
      // Sort the punches chronologically to ensure the correct order
      const punches = punchesByEmployee[workno].sort(
        (a, b) => new Date(a.checktime) - new Date(b.checktime)
      );
      await syncEmployee(workno, punches, startOfDay, endOfDay);
    }
  } catch (error) {
    console.error(
      "❌ A major error occurred in the sync cycle:",
      error.message,
      error.stack
    );
  }
}

// ========================================================
// 4️⃣ SCHEDULING & SERVER STARTUP
// ========================================================
const SYNC_INTERVAL_SECONDS = parseInt(process.env.SYNC_INTERVAL_SECONDS) || 60;
let syncInterval = null;
let isSyncing = false;

async function performAutomaticSync() {
  if (isSyncing) {
    console.log("Sync already in progress. Skipping...");
    return;
  }
  isSyncing = true;
  console.log("\n🔄 Starting automatic synchronization...");
  await syncAll();
  console.log("✅ Automatic sync cycle finished.");
  isSyncing = false;
}

function startAutomaticSync() {
  console.log(
    `⏰ Automatic sync starting now, then every ${SYNC_INTERVAL_SECONDS} seconds`
  );
  performAutomaticSync();
  syncInterval = setInterval(
    performAutomaticSync,
    SYNC_INTERVAL_SECONDS * 1000
  );
}

app.post("/trigger-sync", async (req, res) => {
  console.log("Manual sync triggered via API.");
  await performAutomaticSync();
  res.json({ success: true, message: "Manual sync finished." });
});

app.post("/force-checkout-all", async (req, res) => {
  console.log(
    "🚨 MANUAL OVERRIDE: Forcing check-out for all stuck employees..."
  );
  try {
    const openAttendances = await odooRpcCall(
      "hr.attendance",
      "search_read",
      [[["check_out", "=", false]]],
      { fields: ["id", "employee_id"] }
    );
    if (openAttendances.length === 0) {
      console.log("✅ No stuck employees found.");
      return res
        .status(200)
        .json({ success: true, message: "No open attendances found." });
    }
    console.log(`Found ${openAttendances.length} employees to check out.`);
    const checkOutTime = formatForOdoo(new Date());
    for (const attendance of openAttendances) {
      await odooRpcCall("hr.attendance", "write", [
        [attendance.id],
        { check_out: checkOutTime },
      ]);
    }
    console.log("✅ Force check-out process finished.");
    res.status(200).json({
      success: true,
      message: `Successfully checked out ${openAttendances.length} employees.`,
    });
  } catch (error) {
    console.error("❌ Error during force check-out:", error.message);
    res.status(500).json({
      success: false,
      message: "An error occurred.",
      error: error.message,
    });
  }
});

app.get("/", (req, res) => res.json({ status: "running" }));

process.on("SIGINT", () => {
  if (syncInterval) clearInterval(syncInterval);
  console.log("\n🛑 Shutting down gracefully...");
  process.exit(0);
});

validateConfig();
app.listen(PORT, () => {
  console.log(`🚀 Attendance Sync API running on port ${PORT}`);
  startAutomaticSync();
});

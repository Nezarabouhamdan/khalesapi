// server.js
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const xmlrpc = require("xmlrpc");

const { ODOO_URL, ODOO_DB, ODOO_EMAIL, ODOO_PASSWORD, WEBHOOK_PASSWORD } =
  process.env;

const app = express();
app.use(bodyParser.json());

// 1. Secure webhook with basic validation
app.post("/api/anviz-webhook", (req, res, next) => {
  const sentPwd = req.headers["x-webhook-password"] || req.query.password;
  if (WEBHOOK_PASSWORD && sentPwd !== WEBHOOK_PASSWORD) {
    return res.status(401).send("Invalid webhook password");
  }
  next();
});

// 2. Connect to Odoo via XML-RPC
function connectOdoo() {
  const client = xmlrpc.createSecureClient({
    url: `${ODOO_URL}/xmlrpc/2/common`,
  });
  return new Promise((res, rej) => {
    client.methodCall(
      "authenticate",
      [ODOO_DB, ODOO_EMAIL, ODOO_PASSWORD, {}],
      (err, uid) => (err ? rej(err) : res(uid))
    );
  });
}

function execOdoo(uid, model, method, args) {
  const client = xmlrpc.createSecureClient({
    url: `${ODOO_URL}/xmlrpc/2/object`,
  });
  return new Promise((res, rej) => {
    client.methodCall(
      "execute_kw",
      [ODOO_DB, uid, ODOO_PASSWORD, model, method, args],
      (err, result) => (err ? rej(err) : res(result))
    );
  });
}

// 3. Static mapping: CrossChex ID "1" → Odoo Employee ID 100
const crossToOdooId = {
  1: 100,
};

// 4. Handle webhook to log attendance
app.post("/api/anviz-webhook", async (req, res) => {
  const crossId = req.body.data?.employee?.workno;
  const odooEmpId = crossToOdooId[crossId];
  if (!odooEmpId) {
    return res
      .status(404)
      .send(`No static mapping for CrossChex ID ${crossId}`);
  }

  try {
    const uid = await connectOdoo();
    await execOdoo(uid, "hr.attendance", "attendance_manual", [
      [[odooEmpId, req.body.data.check_time]],
    ]);
    console.log(`🟢 Attendance recorded for Odoo Employee #${odooEmpId}`);
    res.send("OK");
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(500).send("Error: " + e.message);
  }
});

// 5. (Optional) Endpoint to review your static mappings
app.get("/mapping", (req, res) => res.json(crossToOdooId));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));

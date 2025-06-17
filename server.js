// server.js
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const xmlrpc = require("xmlrpc");

const { ODOO_URL, ODOO_DB, ODOO_EMAIL, ODOO_PASSWORD } = process.env;
const app = express();
app.use(bodyParser.json());

// 1. Connect to Odoo (XML‑RPC)
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

// 2. Call Odoo methods
function execOdoo(uid, model, method, args) {
  const obj = xmlrpc.createSecureClient({ url: `${ODOO_URL}/xmlrpc/2/object` });
  return new Promise((res, rej) => {
    obj.methodCall(
      "execute_kw",
      [ODOO_DB, uid, ODOO_PASSWORD, model, method, args],
      (err, result) => (err ? rej(err) : res(result))
    );
  });
}

// 4. Manual mapping: CrossChex ID -> Odoo employee id
const mapCrossToOdoo = {}; // e.g. { "1": 154 }

app.post("/map", (req, res) => {
  const { crossId, odooEmpId } = req.body;
  if (!crossId || !odooEmpId)
    return res.status(400).send("crossId and odooEmpId required");
  mapCrossToOdoo[crossId] = odooEmpId;
  res.json({ status: "OK", mapCrossToOdoo });
});

// 5. Webhook receiver to log attendance based on mapping
app.post("/api/anviz-webhook", async (req, res) => {
  const crossId = req.body.data.employee.workno;
  const odooEmpId = mapCrossToOdoo[crossId];
  if (!odooEmpId)
    return res.status(404).send(`No mapping for CrossChex ID ${crossId}`);

  try {
    const uid = await connectOdoo();
    await execOdoo(uid, "hr.attendance", "attendance_manual", [
      [[odooEmpId, req.body.data.check_time]],
    ]);
    console.log(`Logged attendance for Odoo Employee #${odooEmpId}`);
    res.send("OK");
  } catch (e) {
    res.status(500).send("Error: " + e.message);
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

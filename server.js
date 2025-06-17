// server.js
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const xmlrpc = require("xmlrpc");

const { ODOO_URL, ODOO_DB, ODOO_EMAIL, ODOO_PASSWORD } = process.env;
const app = express();
app.use(bodyParser.json());

// CORS Configuration (updated for frontend on 3001)
app.use(
  cors({
    origin: "https://nezarabouhamdan.github.io",

    methods: "GET,POST",
    credentials: true,
    allowedHeaders: "Content-Type,Authorization",
  })
);

app.use(express.json());

// Routes
app.use("/api", odooRouter);

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

const express = require("express");
const xmlrpc = require("xmlrpc");
const router = express.Router();

// Odoo Configuration
const ODOO_DB = process.env.ODOO_DB;
const ODOO_URL = process.env.ODOO_URL;
const ODOO_EMAIL = process.env.ODOO_EMAIL;
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;

const commonClient = xmlrpc.createClient({
  url: `${ODOO_URL}/xmlrpc/2/common`,
});

const objectClient = xmlrpc.createClient({
  url: `${ODOO_URL}/xmlrpc/2/object`,
});

function formatOdooDateTime(date) {
  return date.toISOString().replace(/T/, " ").replace(/\..+/, "");
}

async function authenticate() {
  return new Promise((resolve, reject) => {
    commonClient.methodCall(
      "authenticate",
      [ODOO_DB, ODOO_EMAIL, ODOO_PASSWORD, {}],
      (err, uid) => {
        if (err || uid === false) reject(new Error("Authentication failed"));
        resolve(uid);
      }
    );
  });
}

router.post("/create-meeting", async (req, res) => {
  try {
    const { name, phone, appointmentDate, appointmentTime, branch, inquiry } =
      req.body;
    const uid = await authenticate();

    const [hours, minutes] = appointmentTime.split(":");
    const startDate = new Date(appointmentDate);
    startDate.setHours(hours, minutes);
    const endDate = new Date(startDate.getTime() + 3600000); // +1 hour

    const meetingId = await new Promise((resolve, reject) => {
      objectClient.methodCall(
        "execute_kw",
        [
          ODOO_DB,
          uid,
          ODOO_PASSWORD,
          "calendar.event",
          "create",
          [
            {
              name: `${name}'s Appointment`,
              start: formatOdooDateTime(startDate),
              stop: formatOdooDateTime(endDate),
              description: `Client Details:
              - Name: ${name}
              - Phone: ${phone}
              - Branch: ${branch}
              - Service: ${inquiry}`,
              partner_ids: [9, 23, 1041, 1035],
              location: branch,
            },
          ],
        ],
        (err, value) => (err ? reject(err) : resolve(value))
      );
    });

    res.json({
      success: true,
      meetingId,
      message: "Appointment booked successfully",
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;

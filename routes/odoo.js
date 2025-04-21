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

// ... (Keep existing Odoo configuration and helper functions) ...
async function verifyPartnersExist(uid, partnerIds) {
  return new Promise((resolve, reject) => {
    objectClient.methodCall(
      "execute_kw",
      [
        ODOO_DB,
        uid,
        ODOO_PASSWORD,
        "res.partner",
        "search_count",
        [[["id", "in", partnerIds]]],
      ],
      (err, count) => {
        if (err) reject(err);
        if (count !== partnerIds.length) {
          reject(new Error("Some partners don't exist"));
        }
        resolve(true);
      }
    );
  });
}
const DEFAULT_PARTNER_IDS = [9, 23, 1041, 1035]; // Reuse the same partner IDs

router.post("/create-lead", async (req, res) => {
  try {
    const { name, phone, email, description, branch, inquiry } = req.body;
    const uid = await authenticate();

    // Validate required fields
    if (!name || !phone || !email) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields (name, phone, email)",
      });
    }
    try {
      await verifyPartnersExist(uid, DEFAULT_PARTNER_IDS);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: "Invalid partner configuration",
      });
    }
    let sourceId;

    try {
      // Correct domain structure
      const existingSources = await new Promise((resolve, reject) => {
        objectClient.methodCall(
          "execute_kw",
          [
            ODOO_DB,
            uid,
            ODOO_PASSWORD,
            "utm.source",
            "search",
            [[["name", "=", "Website"]]], // Fixed domain format
          ],
          (err, value) => (err ? reject(err) : resolve(value))
        );
      });

      if (existingSources.length > 0) {
        sourceId = existingSources[0];
      } else {
        sourceId = await new Promise((resolve, reject) => {
          objectClient.methodCall(
            "execute_kw",
            [
              ODOO_DB,
              uid,
              ODOO_PASSWORD,
              "utm.source",
              "create",
              [{ name: "Website" }],
            ],
            (err, value) => (err ? reject(err) : resolve(value))
          );
        });
      }
    } catch (sourceError) {
      console.error("Source handling failed:", sourceError);
      throw new Error("Could not configure lead source");
    }

    const leadData = {
      name: `Website Lead - ${name}`,
      contact_name: name,
      phone: phone,
      email_from: email,
      description: `Branch: ${branch}\nInquiry: ${inquiry}\nDetails: ${description}`,
      // medium_id: 1,  // Only include if you have this configured
      // team_id: 2,    // Only include if you have specific teams
    };
    const leadId = await new Promise((resolve, reject) => {
      objectClient.methodCall(
        "execute_kw",
        [ODOO_DB, uid, ODOO_PASSWORD, "crm.lead", "create", [leadData]],
        (err, value) => (err ? reject(err) : resolve(value))
      );
    });

    // Add followers (users via their partner IDs) without notifying them
    await new Promise((resolve, reject) => {
      objectClient.methodCall(
        "execute_kw",
        [
          ODOO_DB,
          uid,
          ODOO_PASSWORD,
          "crm.lead",
          "message_subscribe",
          [
            [leadId], // Lead IDs array
            DEFAULT_PARTNER_IDS, // Partner IDs array
          ],
          { context: { mail_notify: false } }, // Turn off notification
        ],
        (err, value) => (err ? reject(err) : resolve(value))
      );
    });
    res.json({
      success: true,
      leadId,
      sourceId,
      message: "CRM lead created successfully",
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

//     };

//     // Create the lead in Odoo
//     const leadId = await new Promise((resolve, reject) => {
//       objectClient.methodCall(
//         "execute_kw",
//         [
//           ODOO_DB,
//           uid,
//           ODOO_PASSWORD,
//           "crm.lead", // Odoo model for leads
//           "create",
//           [leadData],
//         ],
//         (err, value) => (err ? reject(err) : resolve(value))
//       );
//     });

//     res.json({
//       success: true,
//       leadId,
//       message: "Lead created successfully",
//     });
//   } catch (error) {
//     console.error("Error creating lead:", error);
//     res.status(500).json({
//       success: false,
//       error: error.message || "Failed to create lead",
//     });
//   }
// });

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

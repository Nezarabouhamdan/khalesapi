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
        [[[["id", "in", partnerIds]]]],
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

const DEFAULT_PARTNER_IDS = [9, 23, 1041, 1035];

// Helper: search for a record id
async function searchUid(model, domain) {
  return new Promise((resolve, reject) => {
    objectClient.methodCall(
      "execute_kw",
      [ODOO_DB, null, ODOO_PASSWORD, model, "search", [domain]],
      (err, ids) => (err ? reject(err) : resolve(ids))
    );
  });
}

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

    // Verify partners exist
    try {
      await verifyPartnersExist(uid, DEFAULT_PARTNER_IDS);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: "Invalid partner configuration",
      });
    }

    // Ensure utm.source record
    let sourceId;
    try {
      const existing = await new Promise((resolve, reject) => {
        objectClient.methodCall(
          "execute_kw",
          [
            ODOO_DB,
            uid,
            ODOO_PASSWORD,
            "utm.source",
            "search",
            [[[["name", "=", "Website"]]]],
          ],
          (err, ids) => (err ? reject(err) : resolve(ids))
        );
      });
      if (existing.length) {
        sourceId = existing[0];
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
            (err, id) => (err ? reject(err) : resolve(id))
          );
        });
      }
    } catch (err) {
      console.error("Source handling failed:", err);
      throw new Error("Could not configure lead source");
    }

    // Create CRM Lead
    const leadData = {
      name: `Website Lead - ${name}`,
      contact_name: name,
      phone,
      email_from: email,
      description: `Branch: ${branch}\nInquiry: ${inquiry}\nDetails: ${description}`,
    };
    const leadId = await new Promise((resolve, reject) => {
      objectClient.methodCall(
        "execute_kw",
        [ODOO_DB, uid, ODOO_PASSWORD, "crm.lead", "create", [leadData]],
        (err, id) => (err ? reject(err) : resolve(id))
      );
    });

    // Subscribe followers
    await new Promise((resolve, reject) => {
      objectClient.methodCall(
        "execute_kw",
        [
          ODOO_DB,
          uid,
          ODOO_PASSWORD,
          "crm.lead",
          "message_subscribe",
          [[leadId], DEFAULT_PARTNER_IDS],
          { context: { mail_notify: false } },
        ],
        (err, value) => (err ? reject(err) : resolve(value))
      );
    });

    // Get 'To-do' activity type ID
    const activityTypeId = await new Promise((resolve, reject) => {
      objectClient.methodCall(
        "execute_kw",
        [
          ODOO_DB,
          uid,
          ODOO_PASSWORD,
          "mail.activity.type",
          "search",
          [[["name", "=", "To-do"]]],
        ],
        (err, value) => {
          if (err) reject(err);
          if (!value?.length)
            reject(new Error("To-do activity type not found"));
          resolve(value[0]);
        }
      );
    });

    // Create activities for each partner
    for (const partnerId of DEFAULT_PARTNER_IDS) {
      // Get user ID from partner ID
      const [userId] = await new Promise((resolve, reject) => {
        objectClient.methodCall(
          "execute_kw",
          [
            ODOO_DB,
            uid,
            ODOO_PASSWORD,
            "res.users",
            "search",
            [[["partner_id", "=", partnerId]]],
          ],
          (err, value) => {
            if (err) reject(err);
            if (!value?.length)
              reject(new Error(`User not found for partner ${partnerId}`));
            resolve(value);
          }
        );
      });

      // Create activity
      await new Promise((resolve, reject) => {
        objectClient.methodCall(
          "execute_kw",
          [
            ODOO_DB,
            uid,
            ODOO_PASSWORD,
            "mail.activity",
            "create",
            [
              {
                activity_type_id: activityTypeId,
                summary: `New Lead: ${leadData.name}`,
                note: `A new lead has been created. Contact: ${leadData.contact_name}, Phone: ${leadData.phone}`,
                user_id: userId,
                res_model: "crm.lead",
                res_id: leadId,
                date_deadline: formatOdooDateTime(new Date()),
              },
            ],
          ],
          (err, value) => (err ? reject(err) : resolve(value))
        );
      });
    }

    res.json({
      success: true,
      leadId,
      sourceId,
      message: "CRM lead created with follow-up activities",
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Existing create-meeting route unchanged
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
              description: `Client Details:\n- Name: ${name}\n- Phone: ${phone}\n- Branch: ${branch}\n- Service: ${inquiry}`,
              partner_ids: DEFAULT_PARTNER_IDS,
              location: branch,
            },
          ],
        ],
        (err, id) => (err ? reject(err) : resolve(id))
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

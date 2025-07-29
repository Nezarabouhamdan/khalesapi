// test_poll.js
require("dotenv").config();
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

async function testPoll() {
  try {
    // Step 1: Authenticate
    const authRes = await axios.post("https://api.eu.crosschexcloud.com/", {
      header: {
        nameSpace: "authorize.token",
        nameAction: "token",
        version: "1.0",
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
      payload: {
        api_key: process.env.CX_API_KEY,
        api_secret: process.env.CX_API_SECRET,
      },
    });
    console.log("🔁 Auth Response:\n", JSON.stringify(authRes.data, null, 2));

    const token =
      authRes.data.payload?.token || authRes.data.data?.payload?.token;
    if (!token) throw new Error("🔴 No token received");

    // Step 2: Fetch attendance
    const scanRes = await axios.post("https://api.eu.crosschexcloud.com/", {
      header: {
        nameSpace: "attendance.record",
        nameAction: "getrecord",
        version: "1.0",
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
      authorize: { type: "token", token },
      payload: {
        begin_time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        end_time: new Date().toISOString(),
        page: 1,
        per_page: 200,
      },
    });
    console.log(
      "📩 Records Response:\n",
      JSON.stringify(scanRes.data, null, 2)
    );
  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
  }
}

testPoll();

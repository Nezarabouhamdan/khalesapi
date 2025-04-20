const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const odooRouter = require("./routes/odoo");

// CORS Configuration (updated with multiple allowed origins)
app.use(
  cors({
    origin: [
      "https://www.kahles.ae",
      "https://kahles.ae", // Add non-www version
    ],
    methods: ["GET", "POST", "OPTIONS"], // Add OPTIONS for preflight
    allowedHeaders: ["Content-Type", "Authorization"], // Array format
    credentials: true,
  })
);
app.use(cors());
app.use(express.json());

// Routes
app.use("/api", odooRouter);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    status: "running",
    message: "Odoo Meeting API Service",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

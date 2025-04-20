const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const odooRouter = require("./routes/odoo");

// CORS Configuration - Fix these issues:
// 1. Remove standalone app.use(cors) line
// 2. Add explicit OPTIONS handling
// 3. Maintain proper middleware order

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);

// Handle preflight requests globally
app.options("*", cors());

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

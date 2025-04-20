const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const odooRouter = require("./routes/odoo");

// CORS Configuration (updated with multiple allowed origins)
app.use(
  cors({
    origin: [
      "https://nezarabouhamdan.github.io",
      "https://www.kahles.ae"  // Added domain
    ],
    methods: "GET,POST",
    credentials: true,
    allowedHeaders: "Content-Type,Authorization",
  })
);

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

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const odooRouter = require("./routes/odoo");

// CORS Configuration (updated for frontend on 3001)
app.use(
  cors({
    origin: "http://localhost:3001",
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

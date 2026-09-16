require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const surveyRoutes = require("./routes/survey");
const dashboardRoutes = require("./routes/dashboard");
const actionPlanRoutes = require("./routes/actionPlans");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/v1", authRoutes);
app.use("/api/v1", surveyRoutes);
app.use("/api/v1", dashboardRoutes);
app.use("/api/v1", actionPlanRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on port ${PORT}`));

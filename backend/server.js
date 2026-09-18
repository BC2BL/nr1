require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes        = require("./routes/auth");
const surveyRoutes      = require("./routes/survey");
const dashboardRoutes   = require("./routes/dashboard");
const actionPlanRoutes  = require("./routes/actionPlans");
const gheRoutes         = require("./routes/ghe");
const gheScoreRoutes    = require("./routes/admin_ghe_scores");
const data = await apiFetch(`/cycles/${cycleInfo.id}/ghes`);

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/v1", authRoutes);
app.use("/api/v1", surveyRoutes);
app.use("/api/v1", dashboardRoutes);
app.use("/api/v1", actionPlanRoutes);
app.use("/api/v1", gheRoutes);
app.use("/api/v1", gheScoreRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
gheList = data || [];   // gheList is now a Response object, not an array

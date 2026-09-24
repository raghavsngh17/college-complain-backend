require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");

const authRoutes = require("../routes/auth");
const complaintRoutes = require("../routes/complaints");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const { requireAuth, requireRole } = require("../middleware/auth");

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const allowedOrigins = (process.env.CORS_ORIGIN || "*").split(",").map(x => x.trim()).filter(Boolean);

app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "1mb" }));

app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false }));

app.get("/", (req, res) => res.json({
  success: true,
  service: "Centurion University Complaint Tracking API v3",
  status: mongoose.connection.readyState === 1 ? "database_connected" : "database_not_connected"
}));

app.get("/api/health", (req, res) => res.json({
  success: true,
  server: "online",
  database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  timestamp: new Date().toISOString()
}));

app.use("/api/auth", authRoutes);
app.use("/api/complaints", complaintRoutes);

app.get("/api/staff", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const staff = await User.find({ role: "staff", active: true }).sort({ name: 1 }).lean();
    res.json({ success: true, staff: staff.map(s => ({ id: s._id.toString(), name: s.name, email: s.email, phone: s.phone || "", department: s.department || "" })) });
  } catch (error) {
    console.error("Staff list error:", error);
    res.status(500).json({ success: false, message: "Failed to load staff" });
  }
});

app.get("/api/admin/stats", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const [total, pending, active, completed, staff] = await Promise.all([
      Complaint.countDocuments(),
      Complaint.countDocuments({ status: "pending" }),
      Complaint.countDocuments({ status: { $in: ["assigned", "progress"] } }),
      Complaint.countDocuments({ status: { $in: ["resolved", "closed"] } }),
      User.countDocuments({ role: "staff", active: true })
    ]);
    res.json({ success: true, stats: { total, pending, active, completed, staff } });
  } catch (error) {
    console.error("Admin stats error:", error);
    res.status(500).json({ success: false, message: "Failed to load dashboard statistics" });
  }
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (err?.type === "entity.too.large") return res.status(413).json({ success: false, message: "Request is too large" });
  res.status(500).json({ success: false, message: "Internal server error" });
});

async function start() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing");
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is missing");
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("MongoDB connected");
  app.listen(PORT, "0.0.0.0", () => console.log(`Complaint API v3 running on port ${PORT}`));
}

start().catch(error => {
  console.error("Startup failed:", error);
  process.exit(1);
});

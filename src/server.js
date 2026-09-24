require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;
const MAX_FILE_SIZE = (Number(process.env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRES_IN = process.env.TOKEN_EXPIRES_IN || "2d";

if (!JWT_SECRET) {
  console.error("JWT_SECRET is missing. Add it to Render Environment Variables.");
}

const allowedOrigins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS origin not allowed"));
  }
}));

app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  }
});

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true, maxlength: 150 },
  phone: { type: String, trim: true, maxlength: 20 },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["student", "staff"], required: true, index: true },
  department: { type: String, trim: true, maxlength: 100, default: "" },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const User = mongoose.model("User", userSchema);

const timelineSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ["pending", "assigned", "progress", "resolved", "closed"],
    required: true
  },
  date: { type: Date, default: Date.now },
  message: { type: String, required: true, maxlength: 500 }
}, { _id: false });

const complaintSchema = new mongoose.Schema({
  complaintNumber: { type: Number, unique: true, index: true },
  id: { type: String, unique: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 150 },
  phone: { type: String, required: true, trim: true, maxlength: 20 },
  category: {
    type: String,
    enum: ["classroom", "wifi", "electricity", "hostel", "cleanliness", "lab", "other"],
    required: true
  },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  photo: {
    data: Buffer,
    contentType: String,
    originalName: String
  },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  status: {
    type: String,
    enum: ["pending", "assigned", "progress", "resolved", "closed"],
    default: "pending",
    index: true
  },
  timeline: { type: [timelineSchema], default: [] }
}, { timestamps: true });

complaintSchema.index({ category: 1, status: 1 });
complaintSchema.index({ createdAt: -1 });

const Complaint = mongoose.model("Complaint", complaintSchema);

function makeComplaintId() {
  return `CU-${new Date().getFullYear()}-${crypto.randomInt(100000, 1000000)}`;
}

async function getNextComplaintNumber() {
  const last = await Complaint.findOne().sort({ complaintNumber: -1 }).select("complaintNumber").lean();
  return (last?.complaintNumber || 0) + 1;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function signToken(payload) {
  if (!JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "You are not authorized for this action" });
    }
    next();
  };
}

function adminOrEnvCredentials(email, password) {
  return normalizeEmail(process.env.ADMIN_EMAIL) === normalizeEmail(email) &&
    String(process.env.ADMIN_PASSWORD || "") === String(password || "");
}

function publicComplaint(c) {
  return {
    id: c.id,
    category: c.category,
    description: c.description,
    status: c.status,
    submittedDate: c.createdAt,
    updatedAt: c.updatedAt,
    timeline: c.timeline || [],
    photoUrl: c.photo ? `/api/complaints/${c.id}/photo` : null
  };
}

function complaintForUser(c) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    category: c.category,
    description: c.description,
    status: c.status,
    submittedDate: c.createdAt,
    updatedAt: c.updatedAt,
    timeline: c.timeline || [],
    photoUrl: c.photo ? `/api/complaints/${c.id}/photo` : null,
    assignedTo: c.assignedTo ? {
      id: c.assignedTo._id || c.assignedTo,
      name: c.assignedTo.name,
      email: c.assignedTo.email,
      department: c.assignedTo.department
    } : null
  };
}

function adminComplaint(c) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    category: c.category,
    description: c.description,
    status: c.status,
    submittedDate: c.createdAt,
    updatedAt: c.updatedAt,
    timeline: c.timeline || [],
    photoUrl: c.photo ? `/api/complaints/${c.id}/photo` : null,
    assignedTo: c.assignedTo ? {
      id: c.assignedTo._id,
      name: c.assignedTo.name,
      email: c.assignedTo.email,
      department: c.assignedTo.department
    } : null
  };
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Centurion University Complaint Tracking API",
    status: mongoose.connection.readyState === 1 ? "database_connected" : "database_not_connected"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    server: "online",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    timestamp: new Date().toISOString()
  });
});

// ---------------- AUTH ----------------

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body || {};
    const cleanEmail = normalizeEmail(email);

    if (!name || !cleanEmail || !password) {
      return res.status(400).json({ success: false, message: "Name, email and password are required" });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    if (cleanEmail === normalizeEmail(process.env.ADMIN_EMAIL)) {
      return res.status(400).json({ success: false, message: "This email is reserved" });
    }

    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    const user = await User.create({
      name: String(name).trim(),
      email: cleanEmail,
      phone: String(phone || "").trim(),
      passwordHash,
      role: "student"
    });

    const token = signToken({
      sub: String(user._id),
      role: "student",
      name: user.name,
      email: user.email
    });

    res.status(201).json({
      success: true,
      message: "Student account created",
      token,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to create student account" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = normalizeEmail(email);

    if (!cleanEmail || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    if (adminOrEnvCredentials(cleanEmail, password)) {
      const token = signToken({
        sub: "env-admin",
        role: "admin",
        name: "Administrator",
        email: normalizeEmail(process.env.ADMIN_EMAIL)
      });

      return res.json({
        success: true,
        token,
        user: {
          id: "env-admin",
          name: "Administrator",
          email: normalizeEmail(process.env.ADMIN_EMAIL),
          role: "admin"
        }
      });
    }

    const user = await User.findOne({ email: cleanEmail, active: true });
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const token = signToken({
      sub: String(user._id),
      role: user.role,
      name: user.name,
      email: user.email
    });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        department: user.department,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Login failed" });
  }
});

app.get("/api/auth/me", authRequired, async (req, res) => {
  if (req.user.role === "admin") {
    return res.json({
      success: true,
      user: {
        id: "env-admin",
        name: req.user.name || "Administrator",
        email: req.user.email,
        role: "admin"
      }
    });
  }

  try {
    const user = await User.findById(req.user.sub).select("name email phone department role active").lean();
    if (!user || !user.active) {
      return res.status(401).json({ success: false, message: "Account not found or inactive" });
    }
    res.json({ success: true, user: { id: user._id, ...user } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to load account" });
  }
});

app.post("/api/auth/staff", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const { name, email, password, phone, department } = req.body || {};
    const cleanEmail = normalizeEmail(email);

    if (!name || !cleanEmail || !password || !department) {
      return res.status(400).json({ success: false, message: "Name, email, password and department are required" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    const existing = await User.findOne({ email: cleanEmail });
    if (existing || cleanEmail === normalizeEmail(process.env.ADMIN_EMAIL)) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    const staff = await User.create({
      name: String(name).trim(),
      email: cleanEmail,
      passwordHash,
      phone: String(phone || "").trim(),
      department: String(department).trim(),
      role: "staff"
    });

    res.status(201).json({
      success: true,
      message: "Staff account created",
      staff: {
        id: staff._id,
        name: staff.name,
        email: staff.email,
        department: staff.department
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to create staff account" });
  }
});

app.get("/api/staff", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const staff = await User.find({ role: "staff", active: true })
      .select("name email phone department")
      .sort({ name: 1 })
      .lean();
    res.json({ success: true, staff });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch staff" });
  }
});

// ---------------- COMPLAINTS ----------------

app.post("/api/complaints", authRequired, requireRole("student"), upload.single("photo"), async (req, res) => {
  try {
    const fields = ["category", "description"];
    const missing = fields.filter(f => !req.body[f] || String(req.body[f]).trim() === "");
    if (missing.length) {
      return res.status(400).json({ success: false, message: `Missing required fields: ${missing.join(", ")}` });
    }

    const student = await User.findById(req.user.sub);
    if (!student || !student.active || student.role !== "student") {
      return res.status(401).json({ success: false, message: "Student account not found" });
    }

    const number = await getNextComplaintNumber();
    const complaint = new Complaint({
      complaintNumber: number,
      id: makeComplaintId(),
      studentId: student._id,
      name: student.name,
      email: student.email,
      phone: student.phone || String(req.body.phone || "").trim(),
      category: req.body.category,
      description: req.body.description,
      photo: req.file ? {
        data: req.file.buffer,
        contentType: req.file.mimetype,
        originalName: req.file.originalname
      } : undefined,
      status: "pending",
      timeline: [{ status: "pending", date: new Date(), message: "Complaint submitted" }]
    });

    await complaint.save();

    res.status(201).json({
      success: true,
      message: "Complaint submitted successfully",
      complaint: complaintForUser(complaint)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to submit complaint" });
  }
});

app.get("/api/complaints/mine", authRequired, requireRole("student"), async (req, res) => {
  try {
    const items = await Complaint.find({
      $or: [
        { studentId: req.user.sub },
        { email: normalizeEmail(req.user.email) }
      ]
    })
      .sort({ createdAt: -1 })
      .populate("assignedTo", "name email department")
      .select("-photo.data")
      .lean();

    res.json({ success: true, complaints: items.map(complaintForUser) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch your complaints" });
  }
});

app.get("/api/complaints/assigned", authRequired, requireRole("staff"), async (req, res) => {
  try {
    const items = await Complaint.find({ assignedTo: req.user.sub })
      .sort({ createdAt: -1 })
      .populate("assignedTo", "name email department")
      .select("-photo.data")
      .lean();

    res.json({ success: true, complaints: items.map(complaintForUser) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch assigned complaints" });
  }
});

app.get("/api/complaints", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const { search = "", status = "", category = "", page = 1, limit = 100 } = req.query;
    const query = {};

    if (status) query.status = status;
    if (category) query.category = category;

    if (String(search).trim()) {
      const safe = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { id: { $regex: safe, $options: "i" } },
        { name: { $regex: safe, $options: "i" } },
        { category: { $regex: safe, $options: "i" } }
      ];
    }

    const pageNumber = Math.max(Number(page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(limit) || 100, 1), 100);

    const [items, total] = await Promise.all([
      Complaint.find(query)
        .sort({ createdAt: -1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize)
        .populate("assignedTo", "name email department")
        .select("-photo.data")
        .lean(),
      Complaint.countDocuments(query)
    ]);

    res.json({
      success: true,
      complaints: items.map(adminComplaint),
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        pages: Math.max(Math.ceil(total / pageSize), 1)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch complaints" });
  }
});

// Public tracking by ID; intentionally returns non-sensitive fields only.
app.get("/api/complaints/:id", async (req, res) => {
  try {
    const complaint = await Complaint.findOne({ id: String(req.params.id).toUpperCase() })
      .select("id category description status createdAt updatedAt timeline photo")
      .lean();

    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complaint not found" });
    }

    res.json({ success: true, complaint: publicComplaint(complaint) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch complaint" });
  }
});

async function getComplaintWithAccess(id, user) {
  const complaint = await Complaint.findOne({ id: String(id).toUpperCase() }).populate("assignedTo", "name email department");
  if (!complaint) return null;
  if (user.role === "admin") return complaint;
  if (user.role === "staff" && String(complaint.assignedTo?._id || complaint.assignedTo) === String(user.sub)) return complaint;
  if (user.role === "student" && (String(complaint.studentId) === String(user.sub) || complaint.email === normalizeEmail(user.email))) return complaint;
  return undefined;
}

app.get("/api/complaints/:id/details", authRequired, async (req, res) => {
  try {
    const complaint = await getComplaintWithAccess(req.params.id, req.user);
    if (complaint === null) return res.status(404).json({ success: false, message: "Complaint not found" });
    if (complaint === undefined) return res.status(403).json({ success: false, message: "You are not authorized to view this complaint" });

    const data = req.user.role === "admin" ? adminComplaint(complaint.toObject ? complaint.toObject() : complaint) : complaintForUser(complaint.toObject ? complaint.toObject() : complaint);
    res.json({ success: true, complaint: data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch complaint details" });
  }
});

app.get("/api/complaints/:id/photo", authRequired, async (req, res) => {
  try {
    const complaint = await getComplaintWithAccess(req.params.id, req.user);
    if (complaint === null) return res.status(404).json({ success: false, message: "Complaint not found" });
    if (complaint === undefined) return res.status(403).json({ success: false, message: "You are not authorized to view this photo" });
    if (!complaint.photo?.data) return res.status(404).json({ success: false, message: "Photo not found" });

    res.set("Content-Type", complaint.photo.contentType || "image/jpeg");
    res.set("Cache-Control", "private, max-age=3600");
    res.send(complaint.photo.data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch photo" });
  }
});

app.patch("/api/complaints/:id/assign", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const { staffId } = req.body || {};
    const complaint = await Complaint.findOne({ id: String(req.params.id).toUpperCase() });
    if (!complaint) return res.status(404).json({ success: false, message: "Complaint not found" });

    let staff = null;
    if (staffId) {
      staff = await User.findOne({ _id: staffId, role: "staff", active: true });
      if (!staff) return res.status(404).json({ success: false, message: "Staff member not found" });
      complaint.assignedTo = staff._id;
      if (complaint.status === "pending") complaint.status = "assigned";
      complaint.timeline.push({
        status: complaint.status,
        date: new Date(),
        message: `Complaint assigned to ${staff.name}${staff.department ? ` (${staff.department})` : ""}`
      });
    } else {
      complaint.assignedTo = null;
      if (complaint.status === "assigned") complaint.status = "pending";
      complaint.timeline.push({
        status: complaint.status,
        date: new Date(),
        message: "Complaint assignment removed"
      });
    }

    await complaint.save();
    await complaint.populate("assignedTo", "name email department");

    res.json({ success: true, message: "Assignment updated", complaint: adminComplaint(complaint.toObject()) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to assign complaint" });
  }
});

app.patch("/api/complaints/:id/status", authRequired, requireRole("admin", "staff"), async (req, res) => {
  try {
    const { status, message } = req.body || {};
    const allowed = ["pending", "assigned", "progress", "resolved", "closed"];

    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid status. Use: ${allowed.join(", ")}` });
    }

    const complaint = await Complaint.findOne({ id: String(req.params.id).toUpperCase() });
    if (!complaint) return res.status(404).json({ success: false, message: "Complaint not found" });

    if (req.user.role === "staff" && String(complaint.assignedTo) !== String(req.user.sub)) {
      return res.status(403).json({ success: false, message: "You can only update complaints assigned to you" });
    }

    complaint.status = status;
    complaint.timeline.push({
      status,
      date: new Date(),
      message: String(message || `Complaint status changed to ${status}`).trim().slice(0, 500)
    });

    await complaint.save();

    res.json({
      success: true,
      message: "Complaint status updated",
      complaint: {
        id: complaint.id,
        status: complaint.status,
        timeline: complaint.timeline,
        updatedAt: complaint.updatedAt
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update complaint" });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({
      success: false,
      message: `Photo must be ${Number(process.env.MAX_FILE_SIZE_MB) || 5}MB or smaller`
    });
  }
  if (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next();
});

async function start() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is missing. Add it to .env before starting.");
    process.exit(1);
  }
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    console.error("ADMIN_EMAIL and ADMIN_PASSWORD are required for admin login.");
    process.exit(1);
  }
  if (!JWT_SECRET) {
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("MongoDB connected");

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend running on http://localhost:${PORT}`);
  });
}

start().catch(error => {
  console.error("Startup failed:", error);
  process.exit(1);
});

const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const crypto = require("crypto");
const Complaint = require("../models/Complaint");
const User = require("../models/User");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const MAX_FILE_SIZE = (Number(process.env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype?.startsWith("image/")) return cb(new Error("Only image files are allowed"));
    cb(null, true);
  }
});

const STATUSES = ["pending", "assigned", "progress", "resolved", "closed"];
const CATEGORIES = ["classroom", "wifi", "electricity", "hostel", "cleanliness", "lab", "other"];

async function generateComplaintId() {
  let id;
  do {
    id = `CU-${new Date().getFullYear()}-${crypto.randomInt(100000, 1000000)}`;
  } while (await Complaint.exists({ id }));
  return id;
}

async function nextLegacyNumber() {
  const last = await Complaint.findOne({ complaintNumber: { $type: "number" } })
    .sort({ complaintNumber: -1 })
    .select("complaintNumber")
    .lean();
  return (last?.complaintNumber || 0) + 1;
}

function photoUrl(id) {
  return `/api/complaints/${encodeURIComponent(id)}/photo`;
}

function publicComplaint(c) {
  const obj = { ...c };
  delete obj.photo;
  return {
    ...obj,
    submittedDate: c.createdAt,
    photoUrl: c.hasPhoto ? photoUrl(c.id) : null
  };
}

async function getComplaintWithRelations(id) {
  return Complaint.findOne({ id: String(id).toUpperCase() })
    .populate("assignedTo", "name email phone department")
    .lean();
}

function canAccessComplaint(user, complaint) {
  if (user.role === "admin") return true;
  if (user.role === "student") return complaint.student && String(complaint.student._id || complaint.student) === String(user.sub);
  if (user.role === "staff") return complaint.assignedTo && String(complaint.assignedTo._id || complaint.assignedTo) === String(user.sub);
  return false;
}

router.post("/", requireAuth, requireRole("student"), upload.single("photo"), async (req, res) => {
  try {
    const { category, description } = req.body || {};
    if (!category || !description) {
      return res.status(400).json({ success: false, message: "Category and description are required" });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: "Invalid complaint category" });
    }

    const student = await User.findById(req.user.sub).lean();
    if (!student || student.role !== "student" || !student.active) {
      return res.status(401).json({ success: false, message: "Student account not available" });
    }

    const id = await generateComplaintId();
    const complaintNumber = await nextLegacyNumber();

    const complaint = await Complaint.create({
      complaintNumber,
      id,
      student: student._id,
      name: student.name,
      email: student.email,
      phone: student.phone || "",
      category,
      description: String(description).trim(),
      photo: req.file ? { data: req.file.buffer, contentType: req.file.mimetype, originalName: req.file.originalname } : undefined,
      status: "pending",
      timeline: [{ status: "pending", date: new Date(), message: "Complaint submitted", changedByRole: "student", changedByName: student.name }]
    });

    res.status(201).json({
      success: true,
      message: "Complaint submitted successfully",
      complaint: {
        id: complaint.id,
        name: complaint.name,
        email: complaint.email,
        phone: complaint.phone,
        category: complaint.category,
        description: complaint.description,
        status: complaint.status,
        submittedDate: complaint.createdAt,
        timeline: complaint.timeline,
        photoUrl: req.file ? photoUrl(complaint.id) : null
      }
    });
  } catch (error) {
    console.error("Create complaint error:", error);
    res.status(500).json({ success: false, message: "Failed to submit complaint" });
  }
});

router.get("/mine", requireAuth, requireRole("student"), async (req, res) => {
  try {
    const items = await Complaint.find({ student: req.user.sub })
      .sort({ createdAt: -1 })
      .populate("assignedTo", "name email department")
      .lean();

    res.json({ success: true, complaints: items.map(c => publicComplaint({ ...c, hasPhoto: Boolean(c.photo?.contentType) })) });
  } catch (error) {
    console.error("Mine complaints error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch your complaints" });
  }
});

router.get("/assigned", requireAuth, requireRole("staff"), async (req, res) => {
  try {
    const items = await Complaint.find({ assignedTo: req.user.sub })
      .sort({ createdAt: -1 })
      .select("-photo.data")
      .populate("assignedTo", "name email department")
      .lean();

    res.json({ success: true, complaints: items.map(c => publicComplaint({ ...c, hasPhoto: Boolean(c.photo?.contentType) })) });
  } catch (error) {
    console.error("Assigned complaints error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch assigned complaints" });
  }
});

router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { search = "", status = "", category = "", page = 1, limit = 50 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (category) query.category = category;
    if (String(search).trim()) {
      const safe = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { id: { $regex: safe, $options: "i" } },
        { name: { $regex: safe, $options: "i" } },
        { email: { $regex: safe, $options: "i" } },
        { category: { $regex: safe, $options: "i" } }
      ];
    }

    const pageNumber = Math.max(Number(page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(limit) || 50, 1), 100);

    const [items, total] = await Promise.all([
      Complaint.find(query)
        .sort({ createdAt: -1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize)
        .select("-photo.data")
        .populate("assignedTo", "name email department")
        .lean(),
      Complaint.countDocuments(query)
    ]);

    res.json({
      success: true,
      complaints: items.map(c => publicComplaint({ ...c, hasPhoto: Boolean(c.photo?.contentType) })),
      pagination: { page: pageNumber, limit: pageSize, total, pages: Math.ceil(total / pageSize) }
    });
  } catch (error) {
    console.error("Admin complaints error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch complaints" });
  }
});

router.get("/:id/photo", requireAuth, async (req, res) => {
  try {
    const complaint = await getComplaintWithRelations(req.params.id);
    if (!complaint?.photo?.data) return res.status(404).json({ success: false, message: "Photo not found" });
    if (!canAccessComplaint(req.user, complaint)) {
      return res.status(403).json({ success: false, message: "You are not authorized to view this photo" });
    }
    res.set("Content-Type", complaint.photo.contentType || "application/octet-stream");
    res.set("Content-Disposition", `inline; filename="${String(complaint.photo.originalName || "complaint-image").replace(/"/g, "")}"`);
    res.set("Cache-Control", "private, max-age=3600");
    res.send(complaint.photo.data);
  } catch (error) {
    console.error("Photo error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch photo" });
  }
});

router.get("/:id/details", requireAuth, async (req, res) => {
  try {
    const complaint = await getComplaintWithRelations(req.params.id);
    if (!complaint) return res.status(404).json({ success: false, message: "Complaint not found" });
    if (!canAccessComplaint(req.user, complaint)) return res.status(403).json({ success: false, message: "You are not authorized to view this complaint" });
    const safe = publicComplaint({ ...complaint, hasPhoto: Boolean(complaint.photo?.contentType) });
    res.json({ success: true, complaint: safe });
  } catch (error) {
    console.error("Complaint details error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch complaint details" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const complaint = await getComplaintWithRelations(req.params.id);
    if (!complaint) return res.status(404).json({ success: false, message: "Complaint not found" });
    const safe = publicComplaint({ ...complaint, hasPhoto: Boolean(complaint.photo?.contentType) });
    delete safe.email;
    delete safe.phone;
    delete safe.assignedTo;
    res.json({ success: true, complaint: safe });
  } catch (error) {
    console.error("Track complaint error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch complaint" });
  }
});

router.patch("/:id/assign", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const staffId = req.body?.staffId || null;
    const complaint = await getComplaintWithRelations(req.params.id);
    if (!complaint) return res.status(404).json({ success: false, message: "Complaint not found" });

    const doc = await Complaint.findById(complaint._id);
    if (!staffId) {
      doc.assignedTo = undefined;
      doc.assignedAt = undefined;
      if (doc.status === "assigned") doc.status = "pending";
      doc.timeline.push({ status: doc.status, date: new Date(), message: "Complaint unassigned by administrator", changedByRole: "admin", changedByName: req.user.name });
    } else {
      if (!mongoose.isValidObjectId(staffId)) return res.status(400).json({ success: false, message: "Invalid staff account" });
      const staff = await User.findOne({ _id: staffId, role: "staff", active: true }).lean();
      if (!staff) return res.status(404).json({ success: false, message: "Staff member not found" });
      doc.assignedTo = staff._id;
      doc.assignedAt = new Date();
      doc.status = "assigned";
      doc.timeline.push({ status: "assigned", date: new Date(), message: `Assigned to ${staff.name} (${staff.department || "Staff"})`, changedByRole: "admin", changedByName: req.user.name });
    }

    await doc.save();
    const updated = await getComplaintWithRelations(doc.id);
    res.json({ success: true, message: "Assignment updated", complaint: publicComplaint({ ...updated, hasPhoto: Boolean(updated.photo?.contentType) }) });
  } catch (error) {
    console.error("Assign complaint error:", error);
    res.status(500).json({ success: false, message: "Failed to update assignment" });
  }
});

router.patch("/:id/status", requireAuth, requireRole("admin", "staff"), async (req, res) => {
  try {
    const { status, message } = req.body || {};
    if (!STATUSES.includes(status)) return res.status(400).json({ success: false, message: `Invalid status. Use: ${STATUSES.join(", ")}` });

    const complaint = await getComplaintWithRelations(req.params.id);
    if (!complaint) return res.status(404).json({ success: false, message: "Complaint not found" });

    if (req.user.role === "staff") {
      const assignedId = complaint.assignedTo?._id || complaint.assignedTo;
      if (!assignedId || String(assignedId) !== String(req.user.sub)) {
        return res.status(403).json({ success: false, message: "Only the assigned staff member can update this complaint" });
      }
    }

    const doc = await Complaint.findById(complaint._id);
    doc.status = status;
    doc.timeline.push({
      status,
      date: new Date(),
      message: String(message || `Complaint status changed to ${status}`).trim().slice(0, 1000),
      changedByRole: req.user.role,
      changedByName: req.user.name
    });
    await doc.save();

    res.json({ success: true, message: "Complaint status updated", complaint: { id: doc.id, status: doc.status, timeline: doc.timeline, updatedAt: doc.updatedAt } });
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({ success: false, message: "Failed to update complaint status" });
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ success: false, message: `Photo must be ${Number(process.env.MAX_FILE_SIZE_MB) || 5}MB or smaller` });
  }
  if (err) return res.status(400).json({ success: false, message: err.message || "Upload failed" });
  next();
});

module.exports = router;

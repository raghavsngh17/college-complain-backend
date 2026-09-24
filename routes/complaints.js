const express = require("express");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const Complaint = require("../models/Complaint");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, "uploads/"),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, GIF and WEBP images are allowed."));
    }
    cb(null, true);
  }
});

function makeComplaintId() {
  const year = new Date().getFullYear();
  const random = crypto.randomInt(100000, 999999);
  return `CU-${year}-${random}`;
}

// Public: submit complaint
router.post("/", upload.single("photo"), async (req, res) => {
  try {
    const { name, email, phone, category, description } = req.body;

    if (!name || !email || !phone || !category || !description) {
      return res.status(400).json({ message: "All required fields must be provided." });
    }

    const complaintId = makeComplaintId();
    const photoUrl = req.file
      ? `/uploads/${req.file.filename}`
      : null;

    const complaint = await Complaint.create({
      complaintId,
      name,
      email,
      phone,
      category,
      description,
      photoUrl,
      status: "pending",
      timeline: [
        {
          status: "pending",
          message: "Complaint submitted",
          date: new Date()
        }
      ]
    });

    res.status(201).json({
      message: "Complaint submitted successfully.",
      complaintId: complaint.complaintId,
      complaint
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to submit complaint." });
  }
});

// Public: track one complaint
router.get("/:complaintId", async (req, res) => {
  try {
    const complaint = await Complaint.findOne({
      complaintId: req.params.complaintId.toUpperCase()
    }).lean();

    if (!complaint) {
      return res.status(404).json({ message: "Complaint not found." });
    }

    res.json({ complaint });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch complaint." });
  }
});

// Admin: list/filter complaints
router.get("/", requireAdmin, async (req, res) => {
  try {
    const { search, status, category, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (category) filter.category = category;

    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { complaintId: regex },
        { name: regex },
        { category: regex }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [complaints, total] = await Promise.all([
      Complaint.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Complaint.countDocuments(filter)
    ]);

    res.json({
      complaints,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch complaints." });
  }
});

// Admin: update status / department
router.patch("/:complaintId/status", requireAdmin, async (req, res) => {
  try {
    const { status, message, assignedDepartment } = req.body;
    const validStatuses = ["pending", "assigned", "progress", "resolved", "closed"];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status." });
    }

    const complaint = await Complaint.findOne({
      complaintId: req.params.complaintId.toUpperCase()
    });

    if (!complaint) {
      return res.status(404).json({ message: "Complaint not found." });
    }

    complaint.status = status;

    if (assignedDepartment !== undefined) {
      complaint.assignedDepartment = assignedDepartment;
    }

    complaint.timeline.push({
      status,
      message: message || `Complaint status changed to ${status}`,
      date: new Date()
    });

    await complaint.save();

    res.json({
      message: "Complaint updated successfully.",
      complaint
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update complaint." });
  }
});

// Admin: delete complaint
router.delete("/:complaintId", requireAdmin, async (req, res) => {
  try {
    const deleted = await Complaint.findOneAndDelete({
      complaintId: req.params.complaintId.toUpperCase()
    });

    if (!deleted) {
      return res.status(404).json({ message: "Complaint not found." });
    }

    res.json({ message: "Complaint deleted successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to delete complaint." });
  }
});

module.exports = router;

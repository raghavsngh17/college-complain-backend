const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const crypto = require("crypto");
const Complaint = require("../models/Complaint");
const User = require("../models/User");
const { requireAuth, requireRole } = require("../middleware/auth");
const { analyzeComplaint } = require("../src/ai");

const router = express.Router();
const MAX_FILE_SIZE =
  (Number(process.env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype?.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

const STATUSES = ["pending", "assigned", "progress", "resolved", "closed"];
const CATEGORIES = [
  "classroom",
  "wifi",
  "electricity",
  "hostel",
  "cleanliness",
  "lab",
  "other",
];

async function generateComplaintId() {
  let id;

  do {
    id = `CU-${new Date().getFullYear()}-${crypto.randomInt(100000, 1000000)}`;
  } while (await Complaint.exists({ id }));

  return id;
}

function inferContentType(filename = "") {
  const ext = String(filename).toLowerCase().split(".").pop();

  const types = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
  };

  return types[ext] || "application/octet-stream";
}

function photoUrl(id) {
  return `/api/complaints/${encodeURIComponent(id)}/photo`;
}

function publicComplaint(c) {
  const hasPhoto = Boolean(
    c?.photo?.data || c?.photo?.contentType || c?.hasPhoto
  );

  const obj = { ...c };
  delete obj.photo;

  return {
    ...obj,
    submittedDate: c.createdAt,
    hasPhoto,
    photoUrl: hasPhoto ? photoUrl(c.id) : null,
  };
}

async function getComplaintWithRelations(id, includePhoto = false) {
  const query = Complaint.findOne({ id: String(id).toUpperCase() }).populate(
    "assignedTo",
    "name email phone department"
  );

  if (!includePhoto) {
    query.select("-photo.data");
  }

  return query.lean();
}

function canAccessComplaint(user, complaint) {
  if (user.role === "admin") return true;

  if (user.role === "student") {
    const studentId = complaint.student?._id || complaint.student;
    return studentId && String(studentId) === String(user.sub);
  }

  if (user.role === "staff") {
    const assignedId = complaint.assignedTo?._id || complaint.assignedTo;
    return assignedId && String(assignedId) === String(user.sub);
  }

  return false;
}

function normalizePhotoData(photo) {
  if (!photo) return null;

  let data = photo.data;
  let contentType = photo.contentType || inferContentType(photo.originalName);

  if (!data) return null;

  if (Buffer.isBuffer(data)) {
    return { buffer: data, contentType };
  }

  // BSON Binary returned by the native MongoDB driver.
  if (data?._bsontype === "Binary" && typeof data.value === "function") {
    const buffer = data.value();
    return { buffer: Buffer.from(buffer), contentType };
  }

  if (data?.buffer && Buffer.isBuffer(data.buffer)) {
    return { buffer: Buffer.from(data.buffer), contentType };
  }

  if (typeof data === "string") {
    const match = data.match(/^data:(image\/[^;]+);base64,(.+)$/);

    if (match) {
      return {
        buffer: Buffer.from(match[2], "base64"),
        contentType: match[1],
      };
    }

    try {
      return {
        buffer: Buffer.from(data, "base64"),
        contentType,
      };
    } catch {
      return null;
    }
  }

  try {
    return { buffer: Buffer.from(data), contentType };
  } catch {
    return null;
  }
}

router.post(
  "/",
  requireAuth,
  requireRole("student"),
  upload.single("photo"),
  async (req, res) => {
    try {
      const { category, description } = req.body || {};

      if (!category || !description) {
        return res.status(400).json({
          success: false,
          message: "Category and description are required",
        });
      }

      if (!CATEGORIES.includes(category)) {
        return res.status(400).json({
          success: false,
          message: "Invalid complaint category",
        });
      }

      const cleanDescription = String(description).trim();

      if (!cleanDescription) {
        return res.status(400).json({
          success: false,
          message: "Description cannot be empty",
        });
      }

      const student = await User.findById(req.user.sub).lean();

      if (!student || student.role !== "student" || !student.active) {
        return res.status(401).json({
          success: false,
          message: "Student account not available",
        });
      }

      const id = await generateComplaintId();

      const photo = req.file
        ? {
            data: Buffer.from(req.file.buffer),
            contentType: req.file.mimetype,
            originalName: req.file.originalname,
          }
        : undefined;

      const complaint = await Complaint.create({
        id,
        student: student._id,
        name: student.name,
        email: student.email,
        phone: student.phone || "",
        category,
        description: cleanDescription,
        photo,
        status: "pending",
        timeline: [
          {
            status: "pending",
            date: new Date(),
            message: "Complaint submitted",
            changedByRole: "student",
            changedByName: student.name,
          },
        ],
      });

      // Gemini AI analysis
      try {
        const aiAnalysis = await analyzeComplaint({
          category: complaint.category,
          description: complaint.description,
          photo: complaint.photo,
        });

        if (aiAnalysis) {
          complaint.aiAnalysis = aiAnalysis;
          await complaint.save();

          console.log(
            `AI analysis completed for complaint ${complaint.id}`
          );
        } else {
          console.log(
            `AI analysis unavailable for complaint ${complaint.id}`
          );
        }
      } catch (aiError) {
        console.error(
          `AI analysis failed for complaint ${complaint.id}:`,
          aiError?.message || aiError
        );
      }

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
          aiAnalysis: complaint.aiAnalysis || null,
          hasPhoto: Boolean(req.file),
          photoUrl: req.file ? photoUrl(complaint.id) : null,
        },
      });
    } catch (error) {
      console.error("Create complaint error:", error);

      if (error?.code === 11000) {
        return res.status(409).json({
          success: false,
          message:
            "A complaint ID conflict occurred. Please submit again; your existing complaint data is safe.",
        });
      }

      res.status(500).json({
        success: false,
        message: "Failed to submit complaint",
      });
    }
  }
);

router.get("/mine", requireAuth, requireRole("student"), async (req, res) => {
  try {
    const items = await Complaint.find({ student: req.user.sub })
      .sort({ createdAt: -1 })
      .select("-photo.data")
      .populate("assignedTo", "name email department")
      .lean();

    res.json({
      success: true,
      complaints: items.map((c) =>
        publicComplaint({
          ...c,
          hasPhoto: Boolean(c.photo?.contentType),
        })
      ),
    });
  } catch (error) {
    console.error("Mine complaints error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch your complaints",
    });
  }
});

router.get("/assigned", requireAuth, requireRole("staff"), async (req, res) => {
  try {
    const items = await Complaint.find({ assignedTo: req.user.sub })
      .sort({ createdAt: -1 })
      .select("-photo.data")
      .populate("assignedTo", "name email department")
      .lean();

    res.json({
      success: true,
      complaints: items.map((c) =>
        publicComplaint({
          ...c,
          hasPhoto: Boolean(c.photo?.contentType),
        })
      ),
    });
  } catch (error) {
    console.error("Assigned complaints error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch assigned complaints",
    });
  }
});

router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { search = "", status = "", category = "", page = 1, limit = 50 } = req.query;
    const query = {};

    if (status && STATUSES.includes(String(status))) query.status = status;
    if (category && CATEGORIES.includes(String(category))) query.category = category;

    if (String(search).trim()) {
      const safe = String(search)
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      query.$or = [
        { id: { $regex: safe, $options: "i" } },
        { name: { $regex: safe, $options: "i" } },
        { email: { $regex: safe, $options: "i" } },
        { category: { $regex: safe, $options: "i" } },
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
        .populate("assignedTo", "name email phone department")
        .lean(),
      Complaint.countDocuments(query),
    ]);

    res.json({
      success: true,
      complaints: items.map((c) =>
        publicComplaint({
          ...c,
          hasPhoto: Boolean(c.photo?.contentType),
        })
      ),
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        pages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("Admin complaints error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch complaints",
    });
  }
});

// IMPORTANT: This route must stay ABOVE /:id.
router.get("/:id/photo", requireAuth, async (req, res) => {
  try {
    const complaint = await getComplaintWithRelations(req.params.id, true);

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found",
      });
    }

    if (!canAccessComplaint(req.user, complaint)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view this photo",
      });
    }

    const normalized = normalizePhotoData(complaint.photo);

    if (!normalized?.buffer?.length) {
      return res.status(404).json({
        success: false,
        message: "Photo not found",
      });
    }

    res.set("Content-Type", normalized.contentType);
    res.set(
      "Content-Disposition",
      `inline; filename="${String(
        complaint.photo?.originalName || "complaint-image"
      ).replace(/["\\\r\n]/g, "")}"`
    );
    res.set("Cache-Control", "private, no-store, max-age=0");
    res.set("X-Content-Type-Options", "nosniff");

    return res.send(normalized.buffer);
  } catch (error) {
    console.error("Photo error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch photo",
    });
  }
});

router.get("/:id/details", requireAuth, async (req, res) => {
  try {
    const complaint = await getComplaintWithRelations(req.params.id);

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found",
      });
    }

    if (!canAccessComplaint(req.user, complaint)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view this complaint",
      });
    }

    const safe = publicComplaint({
      ...complaint,
      hasPhoto: Boolean(complaint.photo?.contentType),
    });

    res.json({ success: true, complaint: safe });
  } catch (error) {
    console.error("Complaint details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch complaint details",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const complaint = await getComplaintWithRelations(req.params.id);

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found",
      });
    }

    const safe = publicComplaint({
      ...complaint,
      hasPhoto: Boolean(complaint.photo?.contentType),
    });

    delete safe.email;
    delete safe.phone;
    delete safe.assignedTo;

    res.json({ success: true, complaint: safe });
  } catch (error) {
    console.error("Track complaint error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch complaint",
    });
  }
});

router.patch("/:id/assign", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const staffId = req.body?.staffId || null;
    const complaint = await getComplaintWithRelations(req.params.id);

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found",
      });
    }

    const doc = await Complaint.findById(complaint._id);

    if (!staffId) {
      doc.assignedTo = undefined;
      doc.assignedAt = undefined;

      if (doc.status === "assigned") {
        doc.status = "pending";
      }

      doc.timeline.push({
        status: doc.status,
        date: new Date(),
        message: "Complaint unassigned by administrator",
        changedByRole: "admin",
        changedByName: req.user.name,
      });
    } else {
      if (!mongoose.isValidObjectId(staffId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid staff account",
        });
      }

      const staff = await User.findOne({
        _id: staffId,
        role: "staff",
        active: true,
      }).lean();

      if (!staff) {
        return res.status(404).json({
          success: false,
          message: "Staff member not found",
        });
      }

      doc.assignedTo = staff._id;
      doc.assignedAt = new Date();
      doc.status = "assigned";
      doc.timeline.push({
        status: "assigned",
        date: new Date(),
        message: `Assigned to ${staff.name} (${staff.department || "Staff"})`,
        changedByRole: "admin",
        changedByName: req.user.name,
      });
    }

    await doc.save();

    const updated = await getComplaintWithRelations(doc.id);

    res.json({
      success: true,
      message: "Assignment updated",
      complaint: publicComplaint({
        ...updated,
        hasPhoto: Boolean(updated.photo?.contentType),
      }),
    });
  } catch (error) {
    console.error("Assign complaint error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update assignment",
    });
  }
});

router.patch("/:id/status", requireAuth, requireRole("admin", "staff"), async (req, res) => {
  try {
    const { status, message } = req.body || {};

    if (!STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Use: ${STATUSES.join(", ")}`,
      });
    }

    const complaint = await getComplaintWithRelations(req.params.id);

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found",
      });
    }

    if (req.user.role === "staff") {
      const assignedId = complaint.assignedTo?._id || complaint.assignedTo;

      if (!assignedId || String(assignedId) !== String(req.user.sub)) {
        return res.status(403).json({
          success: false,
          message: "Only the assigned staff member can update this complaint",
        });
      }
    }

    const doc = await Complaint.findById(complaint._id);
    doc.status = status;
    doc.timeline.push({
      status,
      date: new Date(),
      message: String(
        message || `Complaint status changed to ${status}`
      )
        .trim()
        .slice(0, 1000),
      changedByRole: req.user.role,
      changedByName: req.user.name,
    });

    await doc.save();

    res.json({
      success: true,
      message: "Complaint status updated",
      complaint: {
        id: doc.id,
        status: doc.status,
        timeline: doc.timeline,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update complaint status",
    });
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({
      success: false,
      message: `Photo must be ${Number(process.env.MAX_FILE_SIZE_MB) || 5}MB or smaller`,
    });
  }

  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Upload failed",
    });
  }

  next();
});

module.exports = router;



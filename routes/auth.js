const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function publicUser(user) {
  return {
    id: user.id || user._id?.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    role: user.role,
    department: user.department || "",
  };
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id || user._id?.toString(),
      role: user.role,
      email: user.email,
      name: user.name,
      department: user.department || "",
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.TOKEN_EXPIRES_IN || "2d" }
  );
}

router.post("/register", async (req, res) => {
  try {
    const { name, phone, email, password } = req.body || {};

    if (!name || !phone || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, phone, email and password are required",
      });
    }

    if (String(password).length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (
      process.env.ADMIN_EMAIL &&
      normalizedEmail === process.env.ADMIN_EMAIL.trim().toLowerCase()
    ) {
      return res.status(409).json({
        success: false,
        message: "This email is reserved for the administrator",
      });
    }

    const existing = await User.findOne({ email: normalizedEmail }).lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    const user = await User.create({
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: normalizedEmail,
      passwordHash,
      role: "student",
      active: true,
    });

    const token = signToken(user);

    res.status(201).json({
      success: true,
      token,
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Student registration error:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to create student account",
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (
      process.env.ADMIN_EMAIL &&
      process.env.ADMIN_PASSWORD &&
      normalizedEmail === process.env.ADMIN_EMAIL.trim().toLowerCase() &&
      String(password) === process.env.ADMIN_PASSWORD
    ) {
      const admin = {
        id: "admin",
        name: "Administrator",
        email: normalizedEmail,
        role: "admin",
        department: "Administration",
      };

      return res.json({
        success: true,
        token: signToken(admin),
        user: admin,
      });
    }

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+passwordHash"
    );

    if (
      !user ||
      !user.active ||
      !(await bcrypt.compare(String(password), user.passwordHash))
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    res.json({
      success: true,
      token: signToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Login failed" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    if (req.user.role === "admin") {
      return res.json({ success: true, user: req.user });
    }

    const user = await User.findById(req.user.sub).lean();

    if (!user || !user.active) {
      return res.status(401).json({
        success: false,
        message: "Account is inactive or missing",
      });
    }

    res.json({ success: true, user: publicUser(user) });
  } catch (error) {
    console.error("Me error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load account",
    });
  }
});

router.post("/staff", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { name, phone, email, department, password } = req.body || {};

    if (!name || !email || !department || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, department and password are required",
      });
    }

    if (String(password).length < 8) {
      return res.status(400).json({
        success: false,
        message: "Staff password must be at least 8 characters",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (
      process.env.ADMIN_EMAIL &&
      normalizedEmail === process.env.ADMIN_EMAIL.trim().toLowerCase()
    ) {
      return res.status(409).json({
        success: false,
        message: "This email is reserved for the administrator",
      });
    }

    const existing = await User.findOne({ email: normalizedEmail }).lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    const user = await User.create({
      name: String(name).trim(),
      phone: String(phone || "").trim(),
      email: normalizedEmail,
      department: String(department).trim(),
      passwordHash,
      role: "staff",
      active: true,
    });

    res.status(201).json({
      success: true,
      staff: publicUser(user),
    });
  } catch (error) {
    console.error("Staff creation error:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to create staff account",
    });
  }
});

module.exports = router;

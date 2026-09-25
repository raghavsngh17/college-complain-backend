const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, index: true, trim: true, lowercase: true, maxlength: 150 },
  phone: { type: String, trim: true, maxlength: 20 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["student", "staff"], required: true, index: true },
  department: { type: String, trim: true, maxlength: 120 },
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);

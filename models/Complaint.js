const mongoose = require("mongoose");

const timelineSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ["pending", "assigned", "progress", "resolved", "closed"],
    required: true
  },
  date: { type: Date, default: Date.now },
  message: { type: String, required: true, maxlength: 1000 },
  changedByRole: { type: String, enum: ["student", "staff", "admin", "system"], default: "system" },
  changedByName: { type: String, maxlength: 100 }
}, { _id: false });

const complaintSchema = new mongoose.Schema({
  complaintNumber: { type: Number, unique: true, sparse: true, index: true },
  id: { type: String, unique: true, index: true, required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
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
  status: {
    type: String,
    enum: ["pending", "assigned", "progress", "resolved", "closed"],
    default: "pending",
    index: true
  },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  assignedAt: Date,
  timeline: { type: [timelineSchema], default: [] }
}, { timestamps: true });

complaintSchema.index({ category: 1, status: 1 });
complaintSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Complaint", complaintSchema);

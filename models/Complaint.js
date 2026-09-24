const mongoose = require("mongoose");

const timelineSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["pending", "assigned", "progress", "resolved", "closed"],
      required: true
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500
    },
    date: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
);

const complaintSchema = new mongoose.Schema(
  {
    complaintId: {
      type: String,
      unique: true,
      index: true,
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 150
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20
    },
    category: {
      type: String,
      enum: [
        "classroom",
        "wifi",
        "electricity",
        "hostel",
        "cleanliness",
        "lab",
        "other"
      ],
      required: true
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000
    },
    photoUrl: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: ["pending", "assigned", "progress", "resolved", "closed"],
      default: "pending",
      index: true
    },
    assignedDepartment: {
      type: String,
      default: null,
      trim: true
    },
    timeline: {
      type: [timelineSchema],
      default: []
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Complaint", complaintSchema);

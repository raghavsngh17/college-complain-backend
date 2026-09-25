const { GoogleGenAI } = require("@google/genai");

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const ALLOWED_CATEGORIES = [
  "classroom",
  "wifi",
  "electricity",
  "hostel",
  "cleanliness",
  "lab",
  "other",
];

function cleanJsonText(text = "") {
  let cleaned = text.trim();

  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }

  return cleaned;
}

function safeValue(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function normalizePriority(value) {
  const priority = String(value || "").toLowerCase().trim();

  if (["low", "medium", "high", "critical"].includes(priority)) {
    return priority;
  }

  return "medium";
}

function normalizeCategory(value, originalCategory) {
  const category = String(value || "").toLowerCase().trim();

  if (ALLOWED_CATEGORIES.includes(category)) {
    return category;
  }

  return originalCategory;
}

async function analyzeComplaint({ category, description, photo }) {
  if (!process.env.GEMINI_API_KEY) {
    console.log("Gemini AI skipped: GEMINI_API_KEY is not configured.");
    return null;
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const prompt = `
You are an AI assistant for a university complaint tracking system.

Analyze the student's complaint and return ONLY valid JSON.

Original complaint category:
${category}

Complaint description:
${description}

Your job:
1. Create a short summary.
2. Decide the priority.
3. Suggest the most suitable category.
4. Suggest the responsible department.
5. Give a practical recommended action.
6. Create a short work note for staff.
7. Give a confidence level.

Priority must be exactly one of:
low, medium, high, critical

Suggested category must be exactly one of:
classroom, wifi, electricity, hostel, cleanliness, lab, other

Return exactly this JSON structure:

{
  "summary": "short complaint summary",
  "priority": "low|medium|high|critical",
  "suggestedCategory": "classroom|wifi|electricity|hostel|cleanliness|lab|other",
  "department": "responsible university department",
  "recommendation": "recommended action",
  "workNote": "short note for staff",
  "confidence": "low|medium|high"
}

Do not add markdown.
Do not add explanations outside JSON.
`;

  const contents = [
    {
      text: prompt,
    },
  ];

  // Analyze uploaded complaint image when available.
  if (
    photo &&
    photo.data &&
    photo.contentType &&
    photo.contentType.startsWith("image/")
  ) {
    contents.push({
      inlineData: {
        mimeType: photo.contentType,
        data: Buffer.from(photo.data).toString("base64"),
      },
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        responseMimeType: "application/json",
      },
    });

    const rawText = response.text || "";
    const cleanedText = cleanJsonText(rawText);

    const result = JSON.parse(cleanedText);

    return {
      summary: safeValue(result.summary, "Complaint analyzed by AI."),
      priority: normalizePriority(result.priority),
      suggestedCategory: normalizeCategory(
        result.suggestedCategory,
        category
      ),
      department: safeValue(result.department, "Concerned Department"),
      recommendation: safeValue(
        result.recommendation,
        "Review the complaint and take appropriate action."
      ),
      workNote: safeValue(
        result.workNote,
        "Please review and handle this complaint."
      ),
      confidence: ["low", "medium", "high"].includes(
        String(result.confidence || "").toLowerCase()
      )
        ? String(result.confidence).toLowerCase()
        : "medium",
      model: MODEL,
      analyzedAt: new Date(),
    };
  } catch (error) {
    console.error("Gemini AI analysis failed:", error.message);
    return null;
  }
}

module.exports = {
  analyzeComplaint,
};

// Replace the current localStorage submission/search logic with these API helpers.
// Backend default: http://localhost:5000

const API_BASE = "http://localhost:5000/api";

async function submitComplaintToBackend({
  name,
  email,
  phone,
  category,
  description,
  photoFile
}) {
  const formData = new FormData();
  formData.append("name", name);
  formData.append("email", email);
  formData.append("phone", phone);
  formData.append("category", category);
  formData.append("description", description);

  if (photoFile) {
    formData.append("photo", photoFile);
  }

  const response = await fetch(`${API_BASE}/complaints`, {
    method: "POST",
    body: formData
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to submit complaint");
  }

  return data;
}

async function trackComplaintFromBackend(complaintId) {
  const response = await fetch(
    `${API_BASE}/complaints/${encodeURIComponent(complaintId)}`
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Complaint not found");
  }

  return data.complaint;
}

async function adminLogin(email, password) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Login failed");
  }

  localStorage.setItem("adminToken", data.token);
  return data;
}

async function getAdminComplaints(filters = {}) {
  const token = localStorage.getItem("adminToken");

  const params = new URLSearchParams(filters);

  const response = await fetch(
    `${API_BASE}/complaints?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to fetch complaints");
  }

  return data;
}

async function updateComplaintStatus(
  complaintId,
  status,
  message,
  assignedDepartment
) {
  const token = localStorage.getItem("adminToken");

  const response = await fetch(
    `${API_BASE}/complaints/${encodeURIComponent(complaintId)}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        status,
        message,
        assignedDepartment
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to update complaint");
  }

  return data;
}

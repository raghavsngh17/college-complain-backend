# Centurion University Complaint Tracking System — Backend

This backend matches the uploaded frontend's features:

- Submit complaint
- Optional photo upload (max 5 MB)
- Generate complaint ID
- Track complaint by ID
- Store complaint status timeline
- Admin login
- Admin complaint list/search/filter
- Admin status/department update
- Admin delete
- MongoDB persistence
- Basic security middleware and rate limiting

## 1. Requirements

Install:

- Node.js 18+
- MongoDB Community Server OR a MongoDB Atlas database

## 2. Install

```bash
npm install
```

## 3. Configure

Copy `.env.example` to `.env` and change:

```env
MONGO_URI=mongodb://127.0.0.1:27017/centurion_complaints
JWT_SECRET=put-a-long-random-secret-here
ADMIN_EMAIL=admin@centurion.ac.in
ADMIN_PASSWORD=ChangeThisPassword123!
FRONTEND_URL=http://127.0.0.1:5500
```

If the frontend is opened from another port/domain, set `FRONTEND_URL` accordingly.

## 4. Start

Development:

```bash
npm run dev
```

Production:

```bash
npm start
```

Backend:

`http://localhost:5000`

Health check:

`http://localhost:5000/api/health`

## API

### Submit complaint

`POST /api/complaints`

Use `multipart/form-data`:

- name
- email
- phone
- category
- description
- photo (optional)

### Track complaint

`GET /api/complaints/:complaintId`

Example:

`GET /api/complaints/CU-2026-123456`

### Admin login

`POST /api/auth/login`

JSON:

```json
{
  "email": "admin@centurion.ac.in",
  "password": "your-password"
}
```

Returns a JWT token.

### Admin complaint list

`GET /api/complaints`

Optional query parameters:

- `search`
- `status`
- `category`
- `page`
- `limit`

Header:

`Authorization: Bearer YOUR_TOKEN`

### Admin status update

`PATCH /api/complaints/:complaintId/status`

JSON:

```json
{
  "status": "progress",
  "message": "Maintenance team is working on the issue.",
  "assignedDepartment": "Maintenance Department"
}
```

### Admin delete

`DELETE /api/complaints/:complaintId`

Header:

`Authorization: Bearer YOUR_TOKEN`

## Frontend integration

The uploaded HTML currently stores complaints in browser `localStorage`. The backend replaces that storage with API calls.

For submission, send `FormData` to:

`POST http://localhost:5000/api/complaints`

For tracking, fetch:

`GET http://localhost:5000/api/complaints/{complaintId}`

For the "View All" admin screen, first log in and then send the JWT in the Authorization header.

## Important

Do not put `ADMIN_PASSWORD`, `JWT_SECRET`, or `MONGO_URI` inside the frontend HTML/JavaScript. Keep them only in `.env` on the backend server.

# Centurion Complaint Backend v6

## Main fixes
- Removes stale `complaintId` indexes and synchronizes MongoDB indexes at startup.
- Allows unlimited complaints per student (subject to normal database usage).
- Stores uploaded images directly as MongoDB Buffers.
- Provides authenticated `/api/complaints/:id/photo` endpoint for admin, complaint owner student, or assigned staff.
- Converts MongoDB BSON Binary / Buffer values safely before sending image bytes.
- Keeps student/staff/admin authentication, assignment and status updates.

## Render
Build Command: `npm install`
Start Command: `npm start`

Keep these environment variables in Render:
`MONGODB_URI`, `CORS_ORIGIN`, `MAX_FILE_SIZE_MB`, `JWT_SECRET`, `TOKEN_EXPIRES_IN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.

# Centurion Complaint Tracking System v2

This backend adds real authentication and role-based dashboards for students, staff and admin.

## Roles
- Student: signup/login, submit complaint with optional image, see only own complaints.
- Staff: login, see assigned complaints, update status of assigned complaints.
- Admin: login with Render environment credentials, see all complaints, assign staff, update status, create staff accounts, view uploaded complaint images.

## Render Environment Variables
Set:
- MONGODB_URI
- CORS_ORIGIN=https://centurion-complain.vercel.app
- MAX_FILE_SIZE_MB=5
- JWT_SECRET=long random secret
- ADMIN_EMAIL=your admin email
- ADMIN_PASSWORD=your new strong admin password
- TOKEN_EXPIRES_IN=2d

Do not put MongoDB credentials or ADMIN_PASSWORD in the frontend.

## Deploy
Build: npm install
Start: npm start
Health: /api/health

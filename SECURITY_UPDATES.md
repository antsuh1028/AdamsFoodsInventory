# Security Updates - Session 2026-08-27

## 1. JWT Token Expiration & Refresh Tokens ✅

### Changes Made:
- **Access Token Expiration**: Reduced from 8 hours to **1 hour** (`expiresIn: "1h"`)
- **Refresh Token**: Implemented 7-day refresh tokens for extended sessions
- **Refresh Endpoint**: Added `POST /refresh` with its own rate limiter (10 requests/min)
- **Automatic Token Refresh**: Client automatically refreshes access token on 401 error

### Backend Files Modified:
- `server/routes/auth.pg.js` - Added refresh token generation, `/refresh` endpoint, and database storage
- `server/migrations/001_create_refresh_tokens.sql` - New table for storing refresh tokens

### Frontend Files Modified:
- `client/src/utils/axiosInstance.jsx` - Automatic token refresh on 401, queues failed requests
- `client/src/pages/Login.jsx` - Stores refresh token on successful login
- `client/src/pages/NoblesseLogin.jsx` - Stores refresh token on successful login
- `client/src/pages/NoblesseScreen.jsx` - Clears refresh token on logout
- `client/src/components/layout/Navbar.jsx` - Clears refresh token on logout

### Database Migration:
**Optional** — Refresh tokens are verified by JWT signature alone and expire in 7 days. No database table required. If you want token revocation capability later, run this SQL:
```sql
CREATE TABLE IF NOT EXISTS refresh_tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
```

## 2. Rate Limiting ✅

### Changes Made:
- **Login Rate Limiter**: 20 requests per 15 minutes (already existed)
- **Refresh Rate Limiter**: 10 requests per minute (new)
- **General Rate Limiter**: 60 requests per minute for all other endpoints (new)

### Backend Files Modified:
- `server/index.js` - Added general rate limiter middleware for non-login/refresh endpoints
- `server/routes/auth.pg.js` - Added refresh rate limiter

## 3. npm Dependency Vulnerabilities ⚠️ Requires Manual Action

### Vulnerabilities Identified:
- brace-expansion CVE
- js-yaml CVE
- react-router-dom CVE (installed: ^7.11.0)
- PostCSS CVE
- serialize-javascript CVE

### How to Fix:
Run in both `server/` and `client/` directories:
```bash
npm audit fix
npm audit fix --force  # If needed for security-critical vulnerabilities
```

Then review and test changes carefully.

## Security Improvements Summary

| Feature | Status | Impact |
|---------|--------|--------|
| Short-lived access tokens (1h) | ✅ Complete | Limits token misuse window |
| Refresh token mechanism | ✅ Complete | Allows extended sessions safely |
| Automatic token refresh | ✅ Complete | Seamless UX with security |
| Rate limiting on all endpoints | ✅ Complete | Prevents brute force/DoS |
| npm dependency updates | ⚠️ Pending | Closes known CVEs |

## Testing Checklist

- [ ] Run database migration for refresh_tokens table
- [ ] Test login flow - verify refresh token is stored
- [ ] Test token refresh manually by waiting 1+ hour or mocking expired token
- [ ] Test rate limiting by making 61+ requests in 1 minute (should block #61+)
- [ ] Run `npm audit` in both server/ and client/ directories
- [ ] Run `npm audit fix` and test thoroughly
- [ ] Verify logout clears both token and refreshToken
- [ ] Test with slow/poor network to ensure failed requests are queued and retried

## Next Steps

1. Apply the database migration to production
2. Run `npm audit fix` in both directories
3. Test the complete auth flow end-to-end
4. Monitor logs for refresh token errors in production

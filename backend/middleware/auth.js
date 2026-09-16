const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

// Verifies the token and attaches { adminId, companyId, role } to req.admin.
// Company-scoped routes MUST filter every query by req.admin.companyId —
// this middleware only proves who's asking, not what they're allowed to see.
function requireAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing_token" });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "invalid_or_expired_token" });
  }
}

module.exports = { requireAdmin };

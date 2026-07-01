const jwt = require('jsonwebtoken');
const db = require('./db');

// Secret indipendente da quella della piattaforma strumenti: app diversa, dominio
// diverso, non serve condividerla. L'unica cosa condivisa è la tabella `coach`.
const SECRET = process.env.HUB_JWT_SECRET || 'noesys_hub_secret_2026_change_in_production';
const COOKIE_NAME = 'hub_coach_token';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '12h' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

function requireCoach(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.redirect('/login');
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'coach') return res.redirect('/login');
  req.coach = payload;
  next();
}

module.exports = { signToken, verifyToken, requireCoach, COOKIE_NAME };

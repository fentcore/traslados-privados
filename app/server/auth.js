const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET no esta definido. Configuralo en las variables de entorno.');
}

function signToken(user) {
  return jwt.sign(
    { userId: user.id, workspaceId: user.workspace_id },
    JWT_SECRET,
    { expiresIn: '180d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    req.workspaceId = payload.workspaceId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesion invalida o expirada.' });
  }
}

module.exports = { signToken, requireAuth };

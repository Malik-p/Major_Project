// Source and test snapshots for the ShopSphere demo repository.
// The change-impact engine and code review inspect these line by line.

export const SOURCES = {
  'server/models/User.js': `// Customer account model (REQ-001 / TASK-001)
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['customer', 'seller', 'admin'], default: 'customer' },
  avatarUrl: String
}, { timestamps: true });

userSchema.methods.verifyPassword = function verifyPassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

export const User = mongoose.model('User', userSchema);`,

  'server/controllers/authController.js': `// Registration and login (REQ-001 / TASK-002)
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

const TOKEN_TTL = '7d';

export async function register(req, res) {
  const { name, email, password } = req.body;
  if (!name || !email || String(password).length < 8) {
    return res.status(400).json({ error: 'Name, email and an 8+ character password are required' });
  }
  const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12) });
  res.status(201).json({ token: jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL }) });
}

export async function login(req, res) {
  const user = await User.findOne({ email: String(req.body.email).toLowerCase() });
  if (!user || !(await user.verifyPassword(req.body.password))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL }) });
}`,

  'server/middleware/authenticate.js': `// JWT verification for protected routes (REQ-001 / TASK-003)
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

export async function authenticate(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { sub } = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(sub).select('_id name role');
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}`,

  'server/controllers/passwordResetController.js': `// Password reset flow (REQ-002 / TASK-005, TASK-007)
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ResetToken } from '../models/ResetToken.js';
import { User } from '../models/User.js';
import { sendResetEmail } from '../services/emailService.js';

const TOKEN_LIFETIME_MS = 60 * 60 * 1000; // 60 minutes

export async function requestReset(req, res) {
  const user = await User.findOne({ email: String(req.body.email).toLowerCase() });
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await ResetToken.create({ user: user.id, tokenHash, expiresAt: Date.now() + TOKEN_LIFETIME_MS });
    await sendResetEmail(user.email, token);
  }
  res.status(202).json({ message: 'If the account exists, a reset link has been sent' });
}

export async function resetPassword(req, res) {
  const tokenHash = crypto.createHash('sha256').update(String(req.body.token)).digest('hex');
  const record = await ResetToken.findOneAndDelete({ tokenHash, expiresAt: { $gt: Date.now() } });
  if (!record) return res.status(400).json({ error: 'Reset link is invalid or has expired' });
  await User.updateOne({ _id: record.user }, { passwordHash: await bcrypt.hash(req.body.password, 12) });
  res.json({ message: 'Password updated' });
}`,

  'server/services/searchService.js': `// Product search with escaped user input (REQ-003 / TASK-009, TASK-010)
import { Product } from '../models/Product.js';

const escapeRegex = (value) => value.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');

export async function searchProducts(term) {
  const query = escapeRegex(term.trim()).slice(0, 80);
  if (!query) return [];
  return Product.find({
    $or: [
      { name: { $regex: query, $options: 'i' } },
      { brand: { $regex: query, $options: 'i' } },
      { category: { $regex: query, $options: 'i' } }
    ]
  }).limit(50).lean();
}`,

  'server/controllers/productController.js': `// Product listing and search endpoints (REQ-003, REQ-004)
import { Product } from '../models/Product.js';
import { searchProducts } from '../services/searchService.js';

export async function listProducts(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Number(req.query.pageSize) || 20;
  const [items, total] = await Promise.all([
    Product.find().sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Product.countDocuments()
  ]);
  res.json({ items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
}

export async function search(req, res) {
  res.json({ results: await searchProducts(String(req.query.q ?? '')) });
}`,

  'server/controllers/orderController.js': `// Order creation (REQ-005 / TASK-017, TASK-019)
import { Cart } from '../models/Cart.js';
import { Order } from '../models/Order.js';
import { reserveStock } from '../services/inventoryService.js';

export async function createOrder(req, res) {
  const cart = await Cart.findOne({ user: req.user.id }).populate('items.product');
  if (!cart?.items.length) return res.status(400).json({ error: 'Cart is empty' });
  await reserveStock(cart.items);
  const reference = 'SS-' + Math.random().toString(36).slice(2, 10).toUpperCase();
  const order = await Order.create({ user: req.user.id, items: cart.items, reference, status: 'PENDING' });
  await Cart.deleteOne({ _id: cart.id });
  res.status(201).json({ order });
}`,

  'server/services/inventoryService.js': `// Stock reservation for new orders (REQ-005 / TASK-018)
import { Product } from '../models/Product.js';

export async function reserveStock(items) {
  for (const item of items) {
    const updated = await Product.updateOne(
      { _id: item.product.id, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } }
    );
    if (!updated.modifiedCount) {
      throw Object.assign(new Error(\`\${item.product.name} is out of stock\`), { status: 409 });
    }
  }
}`,

  'server/controllers/uploadController.js': `// Profile image upload endpoint (REQ-006 / TASK-021)
import multer from 'multer';
import { validateProfileImage } from '../middleware/fileValidation.js';
import { storeProfileImage } from '../services/storageService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // reject oversized bodies before buffering
});

export const uploadProfileImage = [
  upload.single('avatar'),
  validateProfileImage,
  async (req, res) => {
    const { url } = await storeProfileImage(req.user.id, req.file);
    res.status(201).json({ avatarUrl: url });
  }
];`,

  'server/middleware/fileValidation.js': `// Validates profile images before they reach storage (REQ-006 / TASK-022)
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];

export function validateProfileImage(req, res, next) {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'An image file is required' });
  }
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return res.status(415).json({ error: 'Only JPEG and PNG images are supported' });
  }
  if (file.size > MAX_FILE_SIZE) {
    return res.status(413).json({ error: 'Image must be 5 MB or smaller' });
  }
  next();
}`,

  'server/services/storageService.js': `// Persists validated profile images with collision-free names (REQ-006 / TASK-021)
import crypto from 'node:crypto';
import path from 'node:path';
import { bucket } from '../config/storage.js';

export async function storeProfileImage(userId, file) {
  const extension = path.extname(file.originalname).toLowerCase();
  const key = \`avatars/\${userId}/\${crypto.randomUUID()}\${extension}\`;
  await bucket.put(key, file.buffer, { contentType: file.mimetype });
  return { key, url: \`/media/\${key}\` };
}`,

  'server/services/paymentService.js': `// Payment gateway integration (REQ-007 / TASK-024)
import { gateway } from '../config/payments.js';
import { Order } from '../models/Order.js';

export async function chargeOrder(req) {
  const order = await Order.findOne({ _id: req.params.orderId, user: req.user.id });
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  return gateway.charges.create({
    amount: req.body.amount,
    currency: 'INR',
    source: req.body.paymentToken,
    metadata: { orderReference: order.reference }
  });
}`,

  'server/middleware/roleGuard.js': `// Role-based authorization (REQ-008 / TASK-027)
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'You do not have permission to perform this action' });
  }
  next();
};`,

  'server/routes/admin.js': `// Administrative routes (REQ-008 / TASK-028)
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/roleGuard.js';
import * as admin from '../controllers/adminController.js';

const router = Router();
router.use(authenticate, requireRole('admin'));
router.get('/users', admin.listUsers);
router.patch('/users/:id/role', admin.changeRole);
router.get('/orders/export', admin.exportOrders);
export default router;`,

  'server/middleware/rateLimiter.js': `// Per-user API rate limiting (REQ-010 / TASK-032)
import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10-minute window
  limit: 50,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  standardHeaders: 'draft-7',
  handler: (req, res) => res.status(429).json({ error: 'Too many requests, try again later' })
});`
};

export const TESTS = {
  'tests/auth.test.js': `// Registration and login (REQ-001 / TASK-004)
import request from 'supertest';
import app from '../server/app.js';

describe('authentication', () => {
  it('registers a customer and returns a JWT', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'Asha', email: 'asha@example.com', password: 'S3curePass!' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
  });
  it('rejects an incorrect password with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });
  it('blocks protected routes without a token', async () => {
    expect((await request(app).get('/api/profile')).status).toBe(401);
  });
});`,

  'tests/passwordReset.test.js': `// Password reset (REQ-002 / TASK-008)
import request from 'supertest';
import app from '../server/app.js';
import { issueResetToken, advanceClock } from './helpers.js';

describe('password reset', () => {
  it('accepts a valid token once', async () => {
    const token = await issueResetToken('asha@example.com');
    expect((await request(app).post('/api/auth/reset').send({ token, password: 'N3wPassword!' })).status).toBe(200);
    expect((await request(app).post('/api/auth/reset').send({ token, password: 'Again123!' })).status).toBe(400);
  });
  it('rejects tokens older than 60 minutes', async () => {
    const token = await issueResetToken('asha@example.com');
    advanceClock(61 * 60 * 1000);
    expect((await request(app).post('/api/auth/reset').send({ token, password: 'N3wPassword!' })).status).toBe(400);
  });
});`,

  'tests/search.test.js': `// Product search (REQ-003 / TASK-012)
import request from 'supertest';
import app from '../server/app.js';

describe('GET /api/products/search', () => {
  it('matches products by brand', async () => {
    const res = await request(app).get('/api/products/search?q=boat');
    expect(res.body.results.every((p) => /boat/i.test(p.brand))).toBe(true);
  });
  it('treats regex characters literally', async () => {
    const res = await request(app).get('/api/products/search?q=.*');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
  });
});`,

  'tests/order.test.js': `// Order creation (REQ-005 / TASK-017)
import request from 'supertest';
import app from '../server/app.js';
import { authHeader, seedCart } from './helpers.js';

describe('POST /api/orders', () => {
  it('creates an order from the cart', async () => {
    await seedCart([{ sku: 'SS-1001', quantity: 2 }]);
    const res = await request(app).post('/api/orders').set(authHeader());
    expect(res.status).toBe(201);
    expect(res.body.order.reference).toMatch(/^SS-/);
  });
  it('rejects an empty cart', async () => {
    expect((await request(app).post('/api/orders').set(authHeader())).status).toBe(400);
  });
});`,

  'tests/upload.test.js': `// End-to-end tests for POST /api/profile/avatar (REQ-006 / TASK-023)
import request from 'supertest';
import app from '../server/app.js';
import { authHeader, imageFixture } from './helpers.js';

describe('POST /api/profile/avatar', () => {
  it('accepts a 1 MB JPEG image', async () => {
    const res = await request(app).post('/api/profile/avatar').set(authHeader())
      .attach('avatar', imageFixture('image/jpeg', 1 * 1024 * 1024), 'avatar.jpg');
    expect(res.status).toBe(201);
  });

  it('accepts a 4 MB PNG image', async () => {
    const res = await request(app).post('/api/profile/avatar').set(authHeader())
      .attach('avatar', imageFixture('image/png', 4 * 1024 * 1024), 'avatar.png');
    expect(res.status).toBe(201);
  });

  it('rejects images larger than 5 MB', async () => {
    const res = await request(app).post('/api/profile/avatar').set(authHeader())
      .attach('avatar', imageFixture('image/png', 6 * 1024 * 1024), 'large.png');
    expect(res.status).toBe(413);
  });

  it('rejects unsupported formats', async () => {
    const res = await request(app).post('/api/profile/avatar').set(authHeader())
      .attach('avatar', imageFixture('image/gif', 200 * 1024), 'avatar.gif');
    expect(res.status).toBe(415);
  });
});`,

  'tests/fileValidation.test.js': `// Unit tests for validateProfileImage (REQ-006 / TASK-023)
import { validateProfileImage } from '../server/middleware/fileValidation.js';
import { mockResponse } from './helpers.js';

const run = (file) => {
  const res = mockResponse();
  const next = jest.fn();
  validateProfileImage({ file }, res, next);
  return { res, next };
};

describe('validateProfileImage', () => {
  it('passes a JPEG at exactly 5 MB', () => {
    expect(run({ mimetype: 'image/jpeg', size: 5 * 1024 * 1024 }).next).toHaveBeenCalled();
  });
  it('passes a PNG under the limit', () => {
    expect(run({ mimetype: 'image/png', size: 512 * 1024 }).next).toHaveBeenCalled();
  });
  it('rejects a file one byte over 5 MB', () => {
    expect(run({ mimetype: 'image/png', size: 5 * 1024 * 1024 + 1 }).res.status).toHaveBeenCalledWith(413);
  });
  it('rejects a missing file', () => {
    expect(run(undefined).res.status).toHaveBeenCalledWith(400);
  });
});`,

  'tests/rbac.test.js': `// Role-based access control (REQ-008 / TASK-029)
import request from 'supertest';
import app from '../server/app.js';
import { tokenFor } from './helpers.js';

describe('admin routes', () => {
  it('returns 403 for customers', async () => {
    const res = await request(app).get('/api/admin/users').set('Authorization', \`Bearer \${await tokenFor('customer')}\`);
    expect(res.status).toBe(403);
  });
  it('allows admins to export orders', async () => {
    const res = await request(app).get('/api/admin/orders/export').set('Authorization', \`Bearer \${await tokenFor('admin')}\`);
    expect(res.status).toBe(200);
  });
});`,

  'tests/rateLimit.test.js': `// Per-user rate limiting (REQ-010 / TASK-033)
import request from 'supertest';
import app from '../server/app.js';
import { authHeaderFor } from './helpers.js';

describe('API rate limiting', () => {
  it('returns 429 after 50 requests in a 10-minute window', async () => {
    const headers = authHeaderFor('user-a');
    for (let i = 0; i < 50; i += 1) await request(app).get('/api/products').set(headers);
    expect((await request(app).get('/api/products').set(headers)).status).toBe(429);
  });
  it('tracks limits per user, not per IP', async () => {
    expect((await request(app).get('/api/products').set(authHeaderFor('user-b'))).status).toBe(200);
  });
});`
};

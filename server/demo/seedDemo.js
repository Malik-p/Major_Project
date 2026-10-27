import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  Activity, Commit, Finding, ImpactAnalysis, Project, PullRequest, Requirement, RequirementVersion,
  SourceFile, Sprint, Task, Test, TraceabilityLink, User
} from '../models/index.js';
import { SOURCES, TESTS } from './sources.js';

export const DEMO_EMAIL = 'demo@devintel.local';
export const DEMO_PASSWORD = 'DevIntelDemo123!';
export const DEMO_PROJECT_NAME = 'ShopSphere — E-Commerce Platform';
const LEGACY_PROJECT_NAMES = ['Profile Platform', 'DevIntel E-Commerce Platform', DEMO_PROJECT_NAME];
const REPO = { owner: 'shopsphere-labs', name: 'shopsphere-platform', url: 'https://github.com/shopsphere-labs/shopsphere-platform' };

const HOUR = 3600000;
const DAY = 24 * HOUR;

export function demoModeEnabled() {
  if (process.env.DEMO_MODE) return process.env.DEMO_MODE === 'true';
  return process.env.NODE_ENV !== 'production';
}

export async function ensureDemoUser() {
  let user = await User.findOne({ email: DEMO_EMAIL });
  if (!user) user = await User.create({ name: 'Demo Examiner', email: DEMO_EMAIL, passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12) });
  return user;
}

export async function demoWorkspaceExists() {
  const user = await User.findOne({ email: DEMO_EMAIL });
  return Boolean(user && await Project.exists({ owner: user.id, name: DEMO_PROJECT_NAME, isDemo: true }));
}

async function deleteProjectData(projectId) {
  await Promise.all([Requirement, RequirementVersion, Task, Sprint, Commit, PullRequest, SourceFile, Test, Finding, TraceabilityLink, ImpactAnalysis, Activity]
    .map((Model) => Model.deleteMany({ project: projectId })));
  await Project.deleteOne({ _id: projectId });
}

/** Overwrites createdAt/updatedAt directly so seeded records carry a realistic history. */
async function backdate(Model, entries) {
  if (!entries.length) return;
  await Model.collection.bulkWrite(entries.map(([id, createdAt, updatedAt = createdAt]) => ({
    updateOne: { filter: { _id: id }, update: { $set: { createdAt, updatedAt } } }
  })));
}

const sha = (prefix, seed) => (prefix + crypto.createHash('sha1').update(seed).digest('hex')).slice(0, 40);

/**
 * Builds the ShopSphere demo workspace: one project whose requirements, tasks, commits,
 * pull requests, source files, tests, findings and activity form a single consistent graph.
 */
export async function seedDemoWorkspace() {
  const now = Date.now();
  const ago = (days, hours = 0) => new Date(now - days * DAY - hours * HOUR);
  const demoUser = await ensureDemoUser();
  const leadUser = await User.findOne({ email: 'sahil@gmail.com' });

  const stale = await Project.find({ name: { $in: LEGACY_PROJECT_NAMES }, owner: { $in: [demoUser.id, leadUser?.id].filter(Boolean) } });
  for (const project of stale) await deleteProjectData(project.id);

  const project = await Project.create({
    name: DEMO_PROJECT_NAME,
    description: 'Production-oriented e-commerce platform for customer authentication, product discovery, profile management, order processing and secure media uploads.',
    repository: REPO,
    owner: demoUser.id,
    members: [demoUser.id, leadUser?.id].filter(Boolean),
    isDemo: true
  });
  const pid = project.id;

  /* ─── Requirements ─────────────────────────────────────────────────────── */
  const requirementSpecs = [
    ['REQ-001', 'User Authentication', 'Customers register with name, email and password, then sign in to receive a JWT that is valid for 7 days.', 'SECURITY', 'CRITICAL', 'VERIFIED', 'Priya Nair', 41, 30,
      ['Customers can register with name, email and password', 'Passwords are hashed with bcrypt before storage', 'Login returns a JWT valid for 7 days', 'Invalid credentials return HTTP 401', 'Protected routes reject requests without a valid token']],
    ['REQ-002', 'Password Reset', 'Users can request a single-use password reset link that expires after 60 minutes.', 'SECURITY', 'HIGH', 'VERIFIED', 'Rohan Gupta', 34, 3,
      ['Reset is requested with a registered email address', 'The response does not reveal whether the account exists', 'Reset tokens expire after 60 minutes', 'A token can be used only once', 'Tokens are stored hashed, never in plaintext']],
    ['REQ-003', 'Product Search', 'Customers can search products by name, brand or category and receive relevant results.', 'FUNCTIONAL', 'HIGH', 'IMPLEMENTED', 'Arjun Mehta', 30, 19,
      ['Search matches product name, brand and category', 'Search is case-insensitive', 'Special characters in the query are treated literally', 'At most 50 results are returned']],
    ['REQ-004', 'Product Pagination', 'Product listings are paginated with 20 items per page and include total count and page metadata.', 'FUNCTIONAL', 'MEDIUM', 'IN_PROGRESS', 'Arjun Mehta', 15, 2,
      ['Listings return 20 items per page by default', 'Response includes page, pageSize, total and totalPages', 'Page size cannot exceed 100 items', 'UI provides next and previous navigation']],
    ['REQ-005', 'Order Creation', 'Customers can place an order from their cart; stock is reserved and a unique order reference is generated.', 'FUNCTIONAL', 'CRITICAL', 'IN_PROGRESS', 'Priya Nair', 14, 1,
      ['An order is created from the current cart contents', 'Stock is reserved atomically for every line item', 'Out-of-stock items return HTTP 409', 'Each order receives a unique, unguessable reference', 'The cart is cleared after a successful order']],
    ['REQ-006', 'Profile Image Upload Validation', 'Users can upload profile images up to 5 MB in JPEG or PNG format.', 'FUNCTIONAL', 'HIGH', 'IMPLEMENTED', 'Sahil', 24, 16,
      ['JPEG images are accepted', 'PNG images are accepted', 'Files larger than 5 MB are rejected', 'Unsupported file formats are rejected', 'A meaningful validation error is returned', 'Upload validation happens before storage']],
    ['REQ-007', 'Payment Validation', 'Card payments are authorised through the gateway token, and the charged amount is always computed on the server.', 'SECURITY', 'CRITICAL', 'AT_RISK', 'Rohan Gupta', 10, 4,
      ['Payments use a gateway token; raw card numbers never reach the server', 'The charge amount is computed from the stored order total', 'Failed authorisations return a clear, retryable error', 'Every charge is linked to an order reference']],
    ['REQ-008', 'Role-Based Access Control', 'Customer, seller and admin roles are enforced on every protected endpoint.', 'SECURITY', 'HIGH', 'IMPLEMENTED', 'Rohan Gupta', 38, 28,
      ['Supported roles are customer, seller and admin', 'Admin endpoints return 403 for non-admin users', 'Role checks run after authentication', 'Role changes are restricted to admins']],
    ['REQ-009', 'Email Notifications', 'Customers receive transactional emails for registration, order confirmation and password reset.', 'FUNCTIONAL', 'MEDIUM', 'READY', 'Priya Nair', 9, 9,
      ['Registration confirmation email is sent', 'Order confirmation email includes the order reference', 'Emails are queued and delivered asynchronously', 'Templates share consistent branding']],
    ['REQ-010', 'API Rate Limiting', 'Authenticated API clients are limited to 50 requests per 10 minutes per user.', 'NON_FUNCTIONAL', 'HIGH', 'VERIFIED', 'Sahil', 37, 20,
      ['Limit is 50 requests per 10-minute window', 'Limits are tracked per authenticated user', 'Exceeded limits return HTTP 429', 'Standard rate-limit headers are returned']]
  ];
  const requirements = await Requirement.create(requirementSpecs.map(([key, title, description, type, priority, status, owner, , , acceptanceCriteria]) => ({
    key, title, description, type, priority, status, owner, acceptanceCriteria, project: pid, createdBy: demoUser.id,
    revision: key === 'REQ-010' ? 2 : 1, changedAt: key === 'REQ-010' ? ago(23) : undefined
  })));
  const R = Object.fromEntries(requirements.map((req) => [req.key, req]));
  await backdate(Requirement, requirementSpecs.map(([key, , , , , , , created, updated]) => [R[key]._id, ago(created), ago(updated)]));

  /* ─── Sprints ──────────────────────────────────────────────────────────── */
  await Sprint.create([
    { name: 'Sprint 1', goal: 'Authentication, RBAC and API foundations', status: 'COMPLETED', startsAt: ago(42), endsAt: ago(29), project: pid },
    { name: 'Sprint 2', goal: 'Password reset, search and profile uploads', status: 'COMPLETED', startsAt: ago(28), endsAt: ago(15), project: pid },
    { name: 'Sprint 3', goal: 'Checkout: pagination, orders and payments', status: 'ACTIVE', startsAt: ago(14), endsAt: new Date(now + DAY), project: pid },
    { name: 'Sprint 4', goal: 'Notifications and checkout hardening', status: 'PLANNED', startsAt: new Date(now + 2 * DAY), endsAt: new Date(now + 15 * DAY), project: pid }
  ]);

  /* ─── Tasks ────────────────────────────────────────────────────────────── */
  const taskSpecs = [
    ['TASK-001', 'REQ-001', 'Design user model with bcrypt password hashing', 'DONE', 'HIGH', 'Priya Nair', '3h', 'Sprint 1', 41],
    ['TASK-002', 'REQ-001', 'Implement registration and login endpoints', 'DONE', 'HIGH', 'Priya Nair', '5h', 'Sprint 1', 39],
    ['TASK-003', 'REQ-001', 'Add JWT authentication middleware', 'DONE', 'HIGH', 'Sahil', '3h', 'Sprint 1', 38],
    ['TASK-004', 'REQ-001', 'Write authentication integration tests', 'DONE', 'MEDIUM', 'Kavya Iyer', '4h', 'Sprint 1', 36],
    ['TASK-005', 'REQ-002', 'Generate hashed single-use reset tokens', 'DONE', 'HIGH', 'Rohan Gupta', '4h', 'Sprint 2', 31],
    ['TASK-006', 'REQ-002', 'Send reset link email', 'DONE', 'MEDIUM', 'Priya Nair', '2h', 'Sprint 2', 29],
    ['TASK-007', 'REQ-002', 'Expire reset tokens after 60 minutes', 'DONE', 'HIGH', 'Rohan Gupta', '2h', 'Sprint 2', 28],
    ['TASK-008', 'REQ-002', 'Write password reset tests', 'DONE', 'MEDIUM', 'Kavya Iyer', '3h', 'Sprint 2', 27],
    ['TASK-009', 'REQ-003', 'Build product search API', 'DONE', 'HIGH', 'Arjun Mehta', '5h', 'Sprint 2', 25],
    ['TASK-010', 'REQ-003', 'Escape and bound search input', 'DONE', 'HIGH', 'Priya Nair', '2h', 'Sprint 2', 24],
    ['TASK-011', 'REQ-003', 'Search results page', 'DONE', 'MEDIUM', 'Arjun Mehta', '6h', 'Sprint 2', 22],
    ['TASK-012', 'REQ-003', 'Write product search tests', 'DONE', 'MEDIUM', 'Kavya Iyer', '3h', 'Sprint 2', 21],
    ['TASK-013', 'REQ-004', 'Paginate product listing API', 'DONE', 'MEDIUM', 'Arjun Mehta', '3h', 'Sprint 3', 10],
    ['TASK-014', 'REQ-004', 'Pagination controls in catalogue UI', 'IN_PROGRESS', 'MEDIUM', 'Arjun Mehta', '4h', 'Sprint 3', 2],
    ['TASK-015', 'REQ-004', 'Return page metadata and bound page size', 'REVIEW', 'MEDIUM', 'Priya Nair', '2h', 'Sprint 3', 1],
    ['TASK-016', 'REQ-004', 'Write pagination tests', 'TODO', 'MEDIUM', 'Kavya Iyer', '3h', 'Sprint 3', 9],
    ['TASK-017', 'REQ-005', 'Order creation endpoint', 'DONE', 'CRITICAL', 'Priya Nair', '6h', 'Sprint 3', 8],
    ['TASK-018', 'REQ-005', 'Reserve stock atomically in a transaction', 'REVIEW', 'CRITICAL', 'Priya Nair', '5h', 'Sprint 3', 0.1],
    ['TASK-019', 'REQ-005', 'Generate unguessable order references', 'IN_PROGRESS', 'HIGH', 'Sahil', '2h', 'Sprint 3', 1],
    ['TASK-020', 'REQ-005', 'Write order workflow tests', 'TODO', 'HIGH', 'Kavya Iyer', '4h', 'Sprint 4', 7],
    ['TASK-021', 'REQ-006', 'Implement profile image upload endpoint', 'DONE', 'HIGH', 'Sahil', '4h', 'Sprint 2', 19],
    ['TASK-022', 'REQ-006', 'Implement file size/type validation', 'DONE', 'HIGH', 'Sahil', '3h', 'Sprint 2', 18],
    ['TASK-023', 'REQ-006', 'Add profile upload tests', 'DONE', 'MEDIUM', 'Kavya Iyer', '3h', 'Sprint 2', 17],
    ['TASK-024', 'REQ-007', 'Integrate payment gateway tokenisation', 'IN_PROGRESS', 'CRITICAL', 'Rohan Gupta', '8h', 'Sprint 3', 4],
    ['TASK-025', 'REQ-007', 'Compute charge amount from stored order total', 'BLOCKED', 'CRITICAL', 'Rohan Gupta', '3h', 'Sprint 3', 4],
    ['TASK-026', 'REQ-007', 'Write payment validation tests', 'TODO', 'HIGH', 'Kavya Iyer', '4h', 'Sprint 4', 6],
    ['TASK-027', 'REQ-008', 'Role guard middleware', 'DONE', 'HIGH', 'Rohan Gupta', '3h', 'Sprint 1', 34],
    ['TASK-028', 'REQ-008', 'Protect admin routes', 'DONE', 'HIGH', 'Sahil', '2h', 'Sprint 1', 33],
    ['TASK-029', 'REQ-008', 'Write RBAC tests', 'DONE', 'MEDIUM', 'Kavya Iyer', '3h', 'Sprint 1', 31],
    ['TASK-030', 'REQ-009', 'Create branded email templates', 'TODO', 'MEDIUM', 'Arjun Mehta', '5h', 'Sprint 4', 9],
    ['TASK-031', 'REQ-009', 'Asynchronous email queue', 'TODO', 'MEDIUM', 'Priya Nair', '4h', 'Sprint 4', 9],
    ['TASK-032', 'REQ-010', 'Per-user rate limiter (50 requests / 10 minutes)', 'DONE', 'HIGH', 'Sahil', '3h', 'Sprint 2', 22],
    ['TASK-033', 'REQ-010', 'Write rate limiting tests', 'DONE', 'MEDIUM', 'Kavya Iyer', '2h', 'Sprint 2', 21]
  ];
  const taskDescriptions = {
    'TASK-022': 'Reject oversized files and unsupported MIME types before the image reaches storage.',
    'TASK-025': 'Blocked until gateway tokenisation (TASK-024) exposes the authorised order total.',
    'TASK-018': 'Wrap per-item stock decrements in a MongoDB transaction so partial reservations roll back.'
  };
  const dependencies = { 'TASK-025': ['TASK-024'], 'TASK-026': ['TASK-025'], 'TASK-020': ['TASK-018'], 'TASK-016': ['TASK-015'], 'TASK-031': ['TASK-030'] };
  const tasks = await Task.create(taskSpecs.map(([key, reqKey, title, status, priority, assignee, estimate, sprint]) => ({
    key, title, status, priority, assignee, estimate, sprint, description: taskDescriptions[key] ?? '',
    dependencies: dependencies[key] ?? [], requirement: R[reqKey].id, project: pid
  })));
  const T = Object.fromEntries(tasks.map((task) => [task.key, task]));
  await backdate(Task, taskSpecs.map(([key, , , , , , , , updated]) => [T[key]._id, ago(updated + 3), ago(updated)]));

  /* ─── Commits ──────────────────────────────────────────────────────────── */
  const commitSpecs = [
    ['', 'feat(auth): REQ-001 TASK-001 add user model with bcrypt hashing', 'Priya Nair', 40, 'TASK-001', ['server/models/User.js'], 48, 2],
    ['', 'feat(auth): REQ-001 TASK-002 registration and login endpoints', 'Priya Nair', 38, 'TASK-002', ['server/controllers/authController.js'], 61, 4],
    ['', 'feat(auth): REQ-001 TASK-003 JWT authentication middleware', 'Sahil', 37, 'TASK-003', ['server/middleware/authenticate.js'], 27, 0],
    ['', 'test(auth): REQ-001 TASK-004 authentication integration tests', 'Kavya Iyer', 35, 'TASK-004', ['tests/auth.test.js'], 42, 0],
    ['', 'feat(rbac): REQ-008 TASK-027 role guard middleware', 'Rohan Gupta', 33, 'TASK-027', ['server/middleware/roleGuard.js'], 19, 0],
    ['', 'feat(rbac): REQ-008 TASK-028 protect admin routes', 'Sahil', 32, 'TASK-028', ['server/routes/admin.js'], 23, 3],
    ['', 'test(rbac): REQ-008 TASK-029 RBAC tests', 'Kavya Iyer', 31, 'TASK-029', ['tests/rbac.test.js'], 31, 0],
    ['', 'feat(auth): REQ-002 TASK-005 hashed single-use reset tokens', 'Rohan Gupta', 30, 'TASK-005', ['server/controllers/passwordResetController.js'], 56, 0],
    ['', 'feat(auth): REQ-002 TASK-007 expire reset tokens after 60 minutes', 'Rohan Gupta', 27, 'TASK-007', ['server/controllers/passwordResetController.js'], 6, 2],
    ['', 'test(auth): REQ-002 TASK-008 password reset tests', 'Kavya Iyer', 26, 'TASK-008', ['tests/passwordReset.test.js'], 38, 0],
    ['', 'feat(search): REQ-003 TASK-009 product search endpoint', 'Arjun Mehta', 24, 'TASK-009', ['server/controllers/productController.js', 'server/services/searchService.js'], 74, 5],
    ['', 'fix(search): REQ-003 TASK-010 escape regex input and cap results', 'Priya Nair', 23, 'TASK-010', ['server/services/searchService.js'], 9, 3],
    ['', 'feat(api): REQ-010 TASK-032 per-user rate limiting at 50 requests per 10 minutes', 'Sahil', 22, 'TASK-032', ['server/middleware/rateLimiter.js'], 12, 8],
    ['', 'test(api): REQ-010 TASK-033 rate limit tests', 'Kavya Iyer', 21, 'TASK-033', ['tests/rateLimit.test.js'], 29, 0],
    ['', 'test(search): REQ-003 TASK-012 search tests', 'Kavya Iyer', 20, 'TASK-012', ['tests/search.test.js'], 33, 0],
    ['abc123', 'REQ-006 TASK-021 implement profile upload', 'Sahil', 19, 'TASK-021', ['server/controllers/uploadController.js', 'server/services/storageService.js'], 64, 0],
    ['def456', 'REQ-006 TASK-022 enforce image validation', 'Sahil', 18, 'TASK-022', ['server/middleware/fileValidation.js', 'server/controllers/uploadController.js'], 31, 2],
    ['a9e789', 'REQ-006 TASK-023 add upload validation tests', 'Kavya Iyer', 17, 'TASK-023', ['tests/upload.test.js', 'tests/fileValidation.test.js'], 87, 0],
    ['', 'feat(catalog): REQ-004 TASK-013 paginate product listing', 'Arjun Mehta', 9, 'TASK-013', ['server/controllers/productController.js'], 22, 6],
    ['', 'feat(orders): REQ-005 TASK-017 order creation endpoint', 'Priya Nair', 8, 'TASK-017', ['server/controllers/orderController.js', 'tests/order.test.js'], 70, 0],
    ['', 'feat(payments): REQ-007 TASK-024 gateway tokenisation client', 'Rohan Gupta', 4, 'TASK-024', ['server/services/paymentService.js'], 35, 0],
    ['', 'feat(orders): REQ-005 TASK-018 reserve stock per line item', 'Priya Nair', 3, 'TASK-018', ['server/services/inventoryService.js'], 24, 7],
    ['', 'feat(catalog): REQ-004 TASK-015 return page metadata', 'Priya Nair', 1.5, 'TASK-015', ['server/controllers/productController.js'], 8, 2]
  ];
  const commits = await Commit.create(commitSpecs.map(([prefix, message, author, days, taskKey, files, additions, deletions]) => {
    const hash = sha(prefix, message);
    return {
      sha: hash, message, author, committedAt: ago(days), files, additions, deletions, isDemo: true,
      url: `${REPO.url}/commit/${hash}`, task: T[taskKey].id, requirement: T[taskKey].requirement, project: pid
    };
  }));

  /* ─── Pull requests ────────────────────────────────────────────────────── */
  const prSpecs = [
    [31, 'Authentication: registration, login and JWT', 'merged', 'Priya Nair', 35, 'TASK-002', ['server/models/User.js', 'server/controllers/authController.js', 'server/middleware/authenticate.js', 'tests/auth.test.js']],
    [34, 'Role guard middleware and admin route protection', 'merged', 'Rohan Gupta', 31, 'TASK-027', ['server/middleware/roleGuard.js', 'server/routes/admin.js', 'tests/rbac.test.js']],
    [36, 'Password reset with expiring single-use tokens', 'merged', 'Rohan Gupta', 26, 'TASK-005', ['server/controllers/passwordResetController.js', 'tests/passwordReset.test.js']],
    [38, 'Per-user API rate limiting', 'merged', 'Sahil', 21, 'TASK-032', ['server/middleware/rateLimiter.js', 'tests/rateLimit.test.js']],
    [39, 'Product search API', 'merged', 'Arjun Mehta', 20, 'TASK-009', ['server/controllers/productController.js', 'server/services/searchService.js', 'tests/search.test.js']],
    [42, 'Implement secure profile image upload', 'merged', 'Sahil', 16, 'TASK-022', ['server/controllers/uploadController.js', 'server/middleware/fileValidation.js', 'server/services/storageService.js', 'tests/upload.test.js', 'tests/fileValidation.test.js']],
    [45, 'Product listing pagination', 'open', 'Arjun Mehta', 1.5, 'TASK-013', ['server/controllers/productController.js']],
    [46, 'Order creation with stock reservation', 'open', 'Priya Nair', 1, 'TASK-017', ['server/controllers/orderController.js', 'server/services/inventoryService.js', 'tests/order.test.js']],
    [47, 'Payment gateway tokenisation (draft)', 'open', 'Rohan Gupta', 4, 'TASK-024', ['server/services/paymentService.js']]
  ];
  const pullRequests = await PullRequest.create(prSpecs.map(([number, title, state, author, days, taskKey, changedFiles]) => ({
    number, title, state, author, changedFiles, isDemo: true, url: `${REPO.url}/pull/${number}`,
    mergedAt: state === 'merged' ? ago(days) : undefined, task: T[taskKey].id, requirement: T[taskKey].requirement, project: pid
  })));
  await backdate(PullRequest, prSpecs.map(([, , , , days], index) => [pullRequests[index]._id, ago(days + 1), ago(days)]));

  /* ─── Source files ─────────────────────────────────────────────────────── */
  const fileSpecs = [
    ['server/models/User.js', 'TASK-001', 'Customer account schema with role and bcrypt password verification.', ['REQ-001']],
    ['server/controllers/authController.js', 'TASK-002', 'Registration and login handlers that issue 7-day JWTs.', ['REQ-001']],
    ['server/middleware/authenticate.js', 'TASK-003', 'Verifies bearer tokens and loads the current user.', ['REQ-001', 'REQ-008']],
    ['server/controllers/passwordResetController.js', 'TASK-005', 'Issues hashed, single-use reset tokens that expire after 60 minutes.', ['REQ-002']],
    ['server/services/searchService.js', 'TASK-009', 'Escaped, case-insensitive product search across name, brand and category.', ['REQ-003']],
    ['server/controllers/productController.js', 'TASK-013', 'Paginated product listing and search endpoints.', ['REQ-004', 'REQ-003']],
    ['server/controllers/orderController.js', 'TASK-017', 'Creates orders from the cart and generates order references.', ['REQ-005']],
    ['server/services/inventoryService.js', 'TASK-018', 'Reserves stock for each order line item.', ['REQ-005']],
    ['server/controllers/uploadController.js', 'TASK-021', 'Receives multipart profile image uploads and stores validated files.', ['REQ-006']],
    ['server/middleware/fileValidation.js', 'TASK-022', 'Enforces profile image size and MIME-type rules before storage.', ['REQ-006']],
    ['server/services/storageService.js', 'TASK-021', 'Persists validated images under collision-free object keys.', ['REQ-006']],
    ['server/services/paymentService.js', 'TASK-024', 'Creates gateway charges for orders.', ['REQ-007']],
    ['server/middleware/roleGuard.js', 'TASK-027', 'Restricts endpoints to customer, seller or admin roles.', ['REQ-008']],
    ['server/routes/admin.js', 'TASK-028', 'Administrative routes protected by authentication and the admin role.', ['REQ-008']],
    ['server/middleware/rateLimiter.js', 'TASK-032', 'Per-user rate limiter: 50 requests per 10-minute window.', ['REQ-010']]
  ];
  const files = await SourceFile.create(fileSpecs.map(([path, taskKey, summary, [reqKey]]) => ({
    path, summary, language: 'JavaScript', content: SOURCES[path], lastAnalyzedAt: ago(1),
    task: T[taskKey].id, requirement: R[reqKey].id, isDemo: true, project: pid
  })));
  const F = Object.fromEntries(files.map((file) => [file.path, file]));

  /* ─── Tests ────────────────────────────────────────────────────────────── */
  const testSpecs = [
    ['tests/auth.test.js', 'Authentication integration tests', 'TASK-004', 'PASSING', 0.3],
    ['tests/passwordReset.test.js', 'Password reset flow', 'TASK-008', 'PASSING', 0.3],
    ['tests/search.test.js', 'Product search', 'TASK-012', 'PASSING', 0.3],
    ['tests/order.test.js', 'Order creation', 'TASK-017', 'PASSING', 0.3],
    ['tests/upload.test.js', 'Profile upload endpoint', 'TASK-023', 'PASSING', 0.3],
    ['tests/fileValidation.test.js', 'Profile image validation middleware', 'TASK-023', 'PASSING', 0.3],
    ['tests/rbac.test.js', 'Role-based access control', 'TASK-029', 'PASSING', 0.3],
    ['tests/rateLimit.test.js', 'Per-user rate limiting', 'TASK-033', 'PASSING', 0.3]
  ];
  const tests = await Test.create(testSpecs.map(([path, name, taskKey, status, days]) => ({
    path, name, status, lastRunAt: ago(days), content: TESTS[path], task: T[taskKey].id,
    requirement: T[taskKey].requirement, isDemo: true, project: pid
  })));

  /* ─── Findings ─────────────────────────────────────────────────────────── */
  const findingSpecs = [
    ['FIND-001', 'REQ-001', 'No account lockout after repeated failed logins', 'LOW', 'SECURITY', 'Login allows unlimited attempts per account; brute-force protection relies only on the global API rate limit.', 'authController.js login(): no failed-attempt counter or lockout.', 0.72, 'UNVERIFIED', 'OPEN', 'server/controllers/authController.js', 12],
    ['FIND-002', 'REQ-002', 'Reset tokens stored in plaintext', 'HIGH', 'SECURITY', 'Earlier implementation stored raw reset tokens; fixed by hashing with SHA-256 before storage.', 'passwordResetController.js now stores tokenHash = sha256(token).', 0.96, 'VERIFIED', 'RESOLVED', 'server/controllers/passwordResetController.js', 29],
    ['FIND-003', 'REQ-003', 'Search input passed to $regex without escaping', 'HIGH', 'SECURITY', 'Unescaped user input in a regex query allowed ReDoS; fixed by escaping and capping the query length.', 'searchService.js escapeRegex() applied before the $regex query.', 0.93, 'VERIFIED', 'RESOLVED', 'server/services/searchService.js', 23],
    ['FIND-004', 'REQ-005', 'Stock reservation is not atomic across line items', 'HIGH', 'RELIABILITY', 'Each line item is decremented separately; if a later item is out of stock, earlier reservations are not rolled back.', 'inventoryService.js L4-L11: per-item updateOne in a loop without a session/transaction.', 0.88, 'VERIFIED', 'OPEN', 'server/services/inventoryService.js', 3],
    ['FIND-005', 'REQ-005', 'Order reference generated with Math.random()', 'MEDIUM', 'SECURITY', 'Math.random() is predictable; references should be unguessable per the acceptance criteria.', "orderController.js L9: 'SS-' + Math.random().toString(36)", 0.85, 'AI_SUGGESTION', 'OPEN', 'server/controllers/orderController.js', 2],
    ['FIND-006', 'REQ-006', 'Profile upload validation may not cover all allowed MIME types', 'MEDIUM', 'VALIDATION', 'The MIME allow-list only contains JPEG and PNG. Mobile clients increasingly send WebP, which is currently rejected with HTTP 415.', 'fileValidation.js L3: ALLOWED_MIME_TYPES = [image/jpeg, image/png]', 0.84, 'AI_SUGGESTION', 'OPEN', 'server/middleware/fileValidation.js', 5],
    ['FIND-007', 'REQ-007', 'Charge amount taken from the client request body', 'CRITICAL', 'SECURITY', 'The payment amount is read from req.body.amount, so a client can pay less than the order total.', 'paymentService.js L8: amount: req.body.amount', 0.97, 'VERIFIED', 'OPEN', 'server/services/paymentService.js', 4],
    ['FIND-008', 'REQ-004', 'Page size parameter is not bounded', 'MEDIUM', 'VALIDATION', 'pageSize comes straight from the query string; a client can request an unbounded page, contradicting the 100-item cap.', 'productController.js L7: const pageSize = Number(req.query.pageSize) || 20;', 0.9, 'AI_SUGGESTION', 'OPEN', 'server/controllers/productController.js', 1.6],
    ['FIND-009', 'REQ-008', 'Order export endpoint lacked an admin role check', 'HIGH', 'SECURITY', 'The export route was registered before the admin guard; fixed by applying requireRole at router level.', "admin.js L8: router.use(authenticate, requireRole('admin'))", 0.95, 'VERIFIED', 'RESOLVED', 'server/routes/admin.js', 30],
    ['FIND-010', 'REQ-010', 'Rate limiter keyed by IP address behind a proxy', 'MEDIUM', 'SECURITY', 'All clients behind the load balancer shared one bucket; fixed by keying on the authenticated user id.', 'rateLimiter.js L7: keyGenerator uses req.user.id', 0.9, 'VERIFIED', 'RESOLVED', 'server/middleware/rateLimiter.js', 21]
  ];
  const findings = await Finding.create(findingSpecs.map(([key, reqKey, title, severity, category, description, evidence, confidence, verificationStatus, status, filePath]) => ({
    key, title, severity, category, description, evidence, confidence, verificationStatus, status, filePath, source: 'REVIEW',
    requirement: R[reqKey].id, task: F[filePath]?.task, isDemo: true, project: pid
  })));
  await backdate(Finding, findingSpecs.map(([, , , , , , , , , , , days], index) => [findings[index]._id, ago(days), ago(days)]));

  /* ─── Traceability links (persistent graph) ────────────────────────────── */
  const links = [
    ...tasks.map((task) => ['TASK', task, task.requirement]),
    ...commits.map((commit) => ['COMMIT', commit, commit.requirement]),
    ...pullRequests.map((pr) => ['PULL_REQUEST', pr, pr.requirement]),
    ...fileSpecs.flatMap(([path, , , reqKeys]) => reqKeys.map((reqKey) => ['SOURCE_FILE', F[path], R[reqKey].id])),
    ...tests.map((test) => ['TEST', test, test.requirement]),
    ...findings.map((finding) => ['FINDING', finding, finding.requirement])
  ];
  await TraceabilityLink.insertMany(links.map(([artifactType, artifact, requirement]) => ({ artifactType, artifact: artifact.id, requirement, project: pid })));

  /* ─── Change history: REQ-010 was revised and revalidated three weeks ago ─ */
  const rateLimitPrevious = {
    title: 'API Rate Limiting',
    description: 'API clients are limited to 100 requests per 15 minutes per IP address.',
    acceptanceCriteria: ['Limit is 100 requests per 15-minute window', 'Limits are tracked per IP address', 'Exceeded limits return HTTP 429']
  };
  await RequirementVersion.create({
    requirement: R['REQ-010'].id, project: pid, version: 1, ...rateLimitPrevious, type: 'NON_FUNCTIONAL', priority: 'HIGH', status: 'IMPLEMENTED',
    changeSummary: 'Limit changed from 100 requests / 15 minutes per IP to 50 requests / 10 minutes per user', changedBy: demoUser.id, impactStatus: 'RESOLVED'
  });
  const limiter = F['server/middleware/rateLimiter.js'];
  const rateTest = tests.find((test) => test.path === 'tests/rateLimit.test.js');
  await ImpactAnalysis.create({
    requirement: R['REQ-010'].id, project: pid, fromVersion: 1, toVersion: 2, generatedBy: 'SYSTEM', status: 'RESOLVED', resolvedAt: ago(20),
    previous: rateLimitPrevious,
    current: { title: R['REQ-010'].title, description: R['REQ-010'].description, acceptanceCriteria: R['REQ-010'].acceptanceCriteria },
    changes: [
      { dimension: 'QUANTITY', unit: 'requests', label: 'Limit (requests)', before: 100, after: 50 },
      { dimension: 'QUANTITY', unit: 'minutes', label: 'Limit (minutes)', before: 15, after: 10 },
      { dimension: 'ACCEPTANCE_CRITERIA', label: 'Acceptance criteria', added: ['Limits are tracked per authenticated user', 'Standard rate-limit headers are returned'], removed: ['Limits are tracked per IP address'] },
      { dimension: 'CONSTRAINTS', label: 'Extracted constraints', before: { maxSize: null, formats: [], quantities: ['100 requests', '15 minutes'] }, after: { maxSize: null, formats: [], quantities: ['50 requests', '10 minutes'] } }
    ],
    impacts: [
      { level: 'DIRECTLY_AFFECTED', artifactType: 'TASK', artifact: T['TASK-032']._id, key: 'TASK-032', title: T['TASK-032'].title, reason: 'Task implements the limit values changed by REQ-010.', evidence: 'rateLimiter.js used windowMs: 15 * 60 * 1000, max: 100.', confidence: 0.95, verificationStatus: 'VERIFIED' },
      { level: 'DIRECTLY_AFFECTED', artifactType: 'SOURCE_FILE', artifact: limiter._id, key: 'rateLimiter.js', title: limiter.path, reason: 'Contained the previous 100 requests / 15 minutes values.', evidence: 'L5: windowMs: 15 * 60 * 1000\nL6: max: 100', confidence: 0.95, verificationStatus: 'VERIFIED' },
      { level: 'REQUIRES_REVALIDATION', artifactType: 'TEST', artifact: rateTest._id, key: 'rateLimit.test.js', title: rateTest.path, reason: 'Asserted 429 after 100 requests.', evidence: 'for (let i = 0; i < 100; i += 1)', confidence: 0.9, verificationStatus: 'REQUIRES_REVALIDATION' }
    ],
    gaps: [{ level: 'GAP', artifactType: 'SOURCE_FILE', key: 'rateLimiter.js', title: 'Limiter keyed by IP instead of user', reason: 'REQ-010 now requires per-user limits.', evidence: 'No keyGenerator configured (defaults to req.ip).', confidence: 0.9, verificationStatus: 'VERIFIED' }],
    risks: [{ severity: 'HIGH', title: 'Configured limit still 100 requests / 15 minutes', reason: 'REQ-010 now specifies 50 requests / 10 minutes.', evidence: 'rateLimiter.js L5-L6', confidence: 0.95, verificationStatus: 'VERIFIED' }],
    recommendations: ['Update limiter to 50 requests per 10-minute window.', 'Key the limiter on the authenticated user id.', 'Update rateLimit.test.js to assert the new limit.', 'Revalidate REQ-010.'],
    unaffected: [], aiSuggestions: []
  });
  await backdate(ImpactAnalysis, [[(await ImpactAnalysis.findOne({ requirement: R['REQ-010'].id }))._id, ago(23), ago(20)]]);
  await backdate(RequirementVersion, [[(await RequirementVersion.findOne({ requirement: R['REQ-010'].id }))._id, ago(23), ago(20)]]);

  /* ─── Activity feed ────────────────────────────────────────────────────── */
  const activity = [
    [0.08, 'TASK', 'TASK-018 moved to Review — "Reserve stock atomically in a transaction"', 'Priya Nair'],
    [1, 'PULL_REQUEST', 'PR #46 opened — "Order creation with stock reservation" linked to REQ-005', 'Priya Nair'],
    [1.5, 'COMMIT', 'Commit linked to REQ-004: "feat(catalog): REQ-004 TASK-015 return page metadata"', 'Priya Nair'],
    [1.6, 'REVIEW', 'AI review identified missing validation in productController.js — FIND-008 (page size not bounded)', 'DevIntel'],
    [3, 'REQUIREMENT', 'REQ-002 marked VERIFIED after password reset tests passed', 'Kavya Iyer'],
    [4, 'REQUIREMENT', 'REQ-007 marked AT RISK — FIND-007: charge amount taken from client request', 'Rohan Gupta'],
    [4, 'TASK', 'TASK-025 blocked by TASK-024 (gateway tokenisation)', 'Rohan Gupta'],
    [5, 'REVIEW', 'AI review flagged WebP gap in fileValidation.js — FIND-006', 'DevIntel'],
    [8, 'COMMIT', 'Commit linked to REQ-005: "feat(orders): REQ-005 TASK-017 order creation endpoint"', 'Priya Nair'],
    [14, 'SPRINT', 'Sprint 3 started — Checkout: pagination, orders and payments', 'Sahil'],
    [16, 'PULL_REQUEST', 'PR #42 merged — "Implement secure profile image upload" linked to REQ-006', 'Sahil'],
    [17, 'TEST', 'tests/upload.test.js and tests/fileValidation.test.js linked to REQ-006 (passing)', 'Kavya Iyer'],
    [20, 'IMPACT', 'REQ-010 revalidated — change impact report resolved', 'Sahil'],
    [23, 'IMPACT', 'REQ-010 changed: 100 requests / 15 min per IP → 50 requests / 10 min per user', 'Sahil'],
    [29, 'REVIEW', 'FIND-002 resolved — reset tokens are now hashed before storage', 'Rohan Gupta'],
    [35, 'PULL_REQUEST', 'PR #31 merged — authentication linked to REQ-001', 'Priya Nair'],
    [42, 'PROJECT', 'Project ShopSphere created and repository shopsphere-labs/shopsphere-platform connected', 'Sahil']
  ];
  await Activity.insertMany(activity.map(([days, type, message, actor]) => ({ project: pid, type, message, actor, at: ago(days) })));
  await backdate(Project, [[project._id, ago(42), ago(0.08)]]);

  return { project, user: demoUser };
}

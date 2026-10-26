import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: new URL('../.env', import.meta.url) });

const { connectDatabase } = await import('./config/db.js');
const { seedDemoWorkspace, DEMO_EMAIL, DEMO_PASSWORD, DEMO_PROJECT_NAME } = await import('./demo/seedDemo.js');

await connectDatabase();
try {
  await seedDemoWorkspace();
  console.log(`Demo workspace "${DEMO_PROJECT_NAME}" is ready.`);
  console.log(`Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}, or use "Launch demo workspace" on the login page.`);
} finally {
  await mongoose.disconnect();
}

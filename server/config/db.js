import mongoose from 'mongoose';

const connectionState = { mode: 'disconnected', host: null };

export function getDatabaseStatus() {
  return { ...connectionState };
}

export async function connectDatabase() {
  const primaryUri = process.env.MONGODB_URI;
  const fallbackUri = process.env.MONGODB_FALLBACK_URI;
  if (!primaryUri) {
    throw new Error('MONGODB_URI is missing. Add your MongoDB connection string to the root .env file.');
  }
  try {
    await mongoose.connect(primaryUri, { serverSelectionTimeoutMS: 10000 });
    connectionState.mode = 'primary';
    connectionState.host = mongoose.connection.host;
  } catch (error) {
    await mongoose.disconnect().catch(() => {});
    const authenticationFailed = error.code === 8000 || /bad auth|authentication failed/i.test(error.message);
    if (fallbackUri && process.env.NODE_ENV !== 'production') {
      console.warn(
        `Primary MongoDB connection failed (${authenticationFailed ? 'authentication rejected' : 'server unavailable'}). Trying MONGODB_FALLBACK_URI for local development only.`,
      );
      try {
        await mongoose.connect(fallbackUri, { serverSelectionTimeoutMS: 5000 });
        connectionState.mode = 'local-fallback';
        connectionState.host = mongoose.connection.host;
        console.warn(
          `WARNING: Using local MongoDB fallback at ${connectionState.host}. Writes are NOT being saved to the primary MongoDB database.`,
        );
        return;
      } catch {
        await mongoose.disconnect().catch(() => {});
        throw new Error(
          'Primary MongoDB connection failed and the configured local fallback is unavailable. Start the local MongoDB service or fix the primary MONGODB_URI.',
        );
      }
    }
    if (authenticationFailed) {
      throw new Error(
        'MongoDB authentication failed. Check the database username and password in the root .env MONGODB_URI. URL-encode special characters in credentials and confirm the database user has access to the selected database.',
      );
    }
    if (error.name === 'MongooseServerSelectionError') {
      throw new Error(
        'Could not reach MongoDB. Check the MONGODB_URI host, network access/IP allowlist, DNS, and cluster availability.',
      );
    }
    throw error;
  }
  console.log(`Connected to primary MongoDB at ${connectionState.host}`);
}

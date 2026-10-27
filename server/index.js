import dotenv from "dotenv";

dotenv.config({
  path: new URL("../.env", import.meta.url),
});

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { connectDatabase, getDatabaseStatus } from "./config/db.js";
import api from "./routes/api.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { demoModeEnabled, demoWorkspaceExists, seedDemoWorkspace } from "./demo/seedDemo.js";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) {
  throw new Error(
    "JWT_SECRET is missing or too short. Create a root .env file from .env.example and set JWT_SECRET to a private random value of at least 24 characters.",
  );
}

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_URL ?? "http://localhost:5173",
  }),
);

app.use(express.json({ limit: "1mb" }));

app.use(
  "/api/v1/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
  }),
);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", database: getDatabaseStatus() });
});

app.use("/api/v1", api);

// Serve the production build (npm run build) from the same origin when it exists.
const distDir = fileURLToPath(new URL("../dist", import.meta.url));
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile("index.html", { root: distDir }));
}

app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT ?? 4000);

connectDatabase()
  .then(async () => {
    if (demoModeEnabled() && !(await demoWorkspaceExists())) {
      await seedDemoWorkspace();
      console.log("Demo workspace seeded (demo@devintel.local).");
    }
  })
  .then(() => {
    app.listen(port, () => {
      console.log(`DevIntel API listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start DevIntel API:", error.message);
    process.exitCode = 1;
  });

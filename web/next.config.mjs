import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app reads the framework's profile files from the repo root, one level up
  outputFileTracingRoot: path.join(here, '..'),
  outputFileTracingIncludes: {
    '/api/**': [
      '../.claude/skills/job-application-assistant/01-candidate-profile.md',
      '../profiles/profiles.json'
    ]
  }
};

export default nextConfig;

// Vercel looks for functions inside the /api folder. This file just hands
// Vercel the existing Express app from server.js, so every route (the
// webpage and all /api and /auth endpoints) keeps working unchanged.
export { default } from '../server.js';

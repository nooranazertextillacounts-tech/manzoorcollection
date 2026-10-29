import { app } from '../src/backend/app.js';

// Disable default body parser so Express middleware can handle custom stream parsing natively on Vercel
export const config = {
  api: {
    bodyParser: false,
  },
};

export default app;

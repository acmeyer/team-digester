import express from 'express';
const router = express.Router();

router.get('/health_check', (_req, res) => {
  res.send('Ok');
});

export default router;

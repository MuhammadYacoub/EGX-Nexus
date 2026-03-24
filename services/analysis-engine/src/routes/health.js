import { Router } from 'express';
import { config } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/', (req, res) => {
  res.json({
    service: 'analysis-engine',
    status: 'ok',
    version: config.analysis.version
  });
});

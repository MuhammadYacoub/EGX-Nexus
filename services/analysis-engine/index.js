import express from 'express';
import { healthRouter } from './src/routes/health.js';
import { analyzeRouter } from './src/routes/analyze.js';
import { connectRedis } from './src/redis/client.js';
import { config } from './src/config.js';

const app = express();
app.use(express.json());

app.use('/health', healthRouter);
app.use('/analyze', analyzeRouter);

connectRedis().then(() => {
  app.listen(config.port, () => {
    console.log(`🚀 analysis-engine running on :${config.port}`);
  });
}).catch(err => {
  console.error("Critical error during startup:", err);
  app.listen(config.port, () => {
    console.log(`🚀 analysis-engine running on :${config.port}`);
  });
});

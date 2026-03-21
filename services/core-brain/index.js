import express from 'express';
import { createClient } from 'redis';

const app = express();
app.use(express.json());

const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.connect().catch(console.error);

app.get('/health', (_, res) => res.json({ service: 'core-brain', status: 'ok' }));

app.listen(3000, () => console.log('🧠 Core Brain running on :3000'));

import express from 'express';
import { createClient } from 'redis';

const app = express();
app.use(express.json());

const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.connect().catch(console.error);

app.get('/health', (_, res) => res.json({ service: 'auth-gateway', status: 'ok' }));

app.post('/session/login', async (req, res) => {
  const { platform } = req.body;

  const allowedPlatforms = ['mubasher', 'thndr'];
  if (!allowedPlatforms.includes(platform)) {
    return res.status(400).json({ error: 'Invalid platform.' });
  }

  try {
    const { default: handler } = await import(`./platforms/${platform}.js`);
    const session = await handler.login();
    await redis.setEx(`session:${platform}`, 3600, JSON.stringify(session));
    res.json({ success: true, platform, expiresIn: 3600 });
  } catch (err) {
    res.status(500).json({ error: `Platform ${platform} not found or failed to login.` });
  }
});

app.listen(3001, () => console.log('🔐 Auth Gateway running on :3001'));

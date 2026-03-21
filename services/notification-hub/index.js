// notification-hub — EGX-Nexus
import express from 'express';
const app = express();
app.use(express.json());

app.get('/health', (_, res) => res.json({ service: 'notification-hub', status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 notification-hub running on :${PORT}`));

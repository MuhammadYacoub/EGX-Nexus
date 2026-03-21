// dashboard-api — EGX-Nexus
import express from 'express';
const app = express();
app.use(express.json());

app.get('/health', (_, res) => res.json({ service: 'dashboard-api', status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 dashboard-api running on :${PORT}`));

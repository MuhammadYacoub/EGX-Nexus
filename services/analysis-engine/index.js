// analysis-engine — EGX-Nexus
import express from 'express';
const app = express();
app.use(express.json());

app.get('/health', (_, res) => res.json({ service: 'analysis-engine', status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 analysis-engine running on :${PORT}`));

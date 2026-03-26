const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth');
const circlesRouter = require('./routes/circles');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/', (_req, res) => {
  res.json({ message: 'OneYear forum backend running' });
});

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/circles', circlesRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: '服务器内部错误' });
});

module.exports = app;

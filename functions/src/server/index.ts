import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import routes from './routes';
import { errorHandler } from './errors';
import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

const app = express();

app.use((req, res, next) => {
  // /clean-urls/ -> /clean-urls
  if (req.path.endsWith('/') && req.path.length > 1) {
    const query = req.url.slice(req.path.length);
    const safepath = req.path.slice(0, -1).replace(/\/+/g, '/');
    res.redirect(301, safepath + query);
    return;
  }
  next();
});
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(compression());
app.use(express.json());
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(routes);
app.use((_req, res) => {
  const error = new Error("The requested resource couldn't be found.");
  error.name = 'NotFoundError';
  logger.error(error.message);
  res.status(404).json({ error: 'Not Found', message: error.message });
});
app.use(errorHandler);

const server = onRequest(
  {
    minInstances: process.env.API_MIN_INSTANCES ? parseInt(process.env.API_MIN_INSTANCES) : 0,
    timeoutSeconds: process.env.API_TIMEOUT_SECONDS
      ? parseInt(process.env.API_TIMEOUT_SECONDS)
      : 60,
  },
  app
);

export default server;

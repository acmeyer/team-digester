import express from 'express';
const router = express.Router();
import * as logger from 'firebase-functions/logger';
import { redis } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { OauthStateStore } from '../types';

router.get('/health_check', (_req, res) => {
  res.send('Ok');
});

router.get('/oauth/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  const { searchParams } = new URL(req.url, process.env.API_BASE_URL);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  logger.info('oauth callback', provider, code, state, { structuredData: true });

  if (!code || !state) {
    throw new Error('Missing code or state');
  }

  const stateData = (await redis.get(`oauth:state:${state}`)) as OauthStateStore;
  const { integrationId, organizationId, userId } = stateData;
  const [organization, integration, user] = await Promise.all([
    prisma.organization.findUnique({
      where: {
        id: organizationId,
      },
    }),
    prisma.integrationApplication.findUnique({
      where: {
        id: integrationId,
        provider: provider,
      },
    }),
    prisma.user.findUnique({
      where: {
        id: userId,
      },
    }),
  ]);

  if (!organization || !integration || !user) {
    throw new Error('Invalid request');
  }

  const resp = await fetch(`${integration.tokenUrl}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: integration.clientId,
      client_secret: integration.clientSecret,
      code: code,
      grant_type: 'authorization_code',
      scope: integration.scope,
      redirect_uri: integration.callbackUrl,
      state: state,
    }),
  });
  const data = await resp.json();
  console.log('data', data);

  await prisma.integrationProviderAccount.create({
    data: {
      provider: provider,
      data: data,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
      integrationApplicationId: integration.id,
      organizationId: organization.id,
      userId: user.id,
    },
  });

  // TODO: set up webhooks and other integration things

  return res.redirect(`slack://app?team=${organization.id}&id=${process.env.SLACK_APP_ID}`);
});

export default router;

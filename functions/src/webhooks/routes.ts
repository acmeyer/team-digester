import express from 'express';
const router = express.Router();
import * as logger from 'firebase-functions/logger';
import { prisma } from '../lib/prisma';
import { Config } from '../config';
import { Webhooks, EmitterWebhookEventName } from '@octokit/webhooks';
import {
  PushEvent,
  PullRequestEvent,
  PullRequestReviewCommentEvent,
  PullRequestReviewEvent,
  PullRequestReviewThreadEvent,
  ReleaseEvent,
  IssueCommentEvent,
  IssuesEvent,
  CommitCommentCreatedEvent,
} from '@octokit/webhooks-types';
import { IncomingWebhook, Prisma } from '@prisma/client';
import { INTEGRATION_NAMES } from '../lib/constants';
import { getInstallationAuth, githubApiRequestWithRetry } from '../lib/github';
import { saveActvity, saveIncomingWebhook } from './utils';

const githubWebhooks = new Webhooks({
  secret: Config.GITHUB_WEBHOOK_SECRET,
});

router.post('/github/webhooks', async (req, res) => {
  const { headers } = req;
  const { 'x-github-event': event } = headers;

  try {
    const webhook = {
      id: req.header('X-GitHub-Delivery') || '',
      name: event as EmitterWebhookEventName,
      payload: JSON.stringify(req.body),
      signature: req.header('X-Hub-Signature') || '',
    };
    await githubWebhooks.verifyAndReceive(webhook);
    return res.status(200).send({
      message: 'Ok',
    });
  } catch (err) {
    logger.error(err, { structuredData: true });
    return res.status(401).send({
      error: 'Unauthorized',
    });
  }
});

githubWebhooks.onError((err) => {
  logger.error(err, { structuredData: true });
  console.error(err);
});

githubWebhooks.on('installation.created', async ({ id, name, payload }) => {
  logger.info('installation.created callback', id, name, payload, { structuredData: true });

  const { installation } = payload;

  // get a token for later usage
  const installationAuth = await getInstallationAuth(installation.id.toString());
  // Use installation to create a new integration installation if necessary,
  // this is a placeholder until it's completed after the OAuth flow
  await prisma.integrationInstallation.upsert({
    where: {
      integrationName_externalId: {
        integrationName: INTEGRATION_NAMES.GITHUB,
        externalId: installation.id.toString(),
      },
    },
    update: {}, // We'll skip updating anyting in the webhook since it should be taken care of in the OAuth flow
    create: {
      integrationName: INTEGRATION_NAMES.GITHUB,
      externalId: installation.id.toString(),
      data: installation as unknown as Prisma.JsonObject,
      accessToken: installationAuth.token,
      accountName: installation.account?.name || installation.account?.login,
    },
  });
});

githubWebhooks.on('installation.deleted', async ({ id, name, payload }) => {
  console.log('installation.deleted callback', { id, name, payload });
  const { installation } = payload;

  // Remove the integration installation from the database
  await prisma.integrationInstallation.delete({
    where: {
      integrationName_externalId: {
        externalId: installation.id.toString(),
        integrationName: INTEGRATION_NAMES.GITHUB,
      },
    },
  });

  // Future question? Should we remove all associated IntegrationAccounts too?
});

const getAccountsForWebhook = async (
  payload:
    | PushEvent
    | PullRequestEvent
    | PullRequestReviewCommentEvent
    | PullRequestReviewEvent
    | PullRequestReviewThreadEvent
    | ReleaseEvent
    | IssueCommentEvent
    | IssuesEvent
    | CommitCommentCreatedEvent,
  webhook: IncomingWebhook
) => {
  const { sender, installation } = payload;

  if (!installation) {
    logger.error('No installation found in event', webhook.id, { structuredData: true });
    await prisma.incomingWebhook.update({
      where: {
        id: webhook.id,
      },
      data: {
        failed: true,
        failedReason: 'No installation found in event',
      },
    });

    throw new Error('No installation found in event');
  }

  // Get the installation and organization
  const integrationInstallation = await prisma.integrationInstallation.findUnique({
    where: {
      integrationName_externalId: {
        integrationName: INTEGRATION_NAMES.GITHUB,
        externalId: installation.id.toString(),
      },
    },
    include: {
      organization: true,
    },
  });

  if (!integrationInstallation || !integrationInstallation.organization) {
    logger.error('No integration installation or organization found for event', webhook.id, {
      structuredData: true,
    });
    await prisma.incomingWebhook.update({
      where: {
        id: webhook.id,
      },
      data: {
        failed: true,
        failedReason: 'No integration installation or organization found for event',
      },
    });
    throw new Error('No integration installation or organization found for event');
  }

  // Get the user and integration account
  const integrationAccount = await prisma.integrationAccount.findUnique({
    where: {
      integrationName_externalId_organizationId: {
        integrationName: INTEGRATION_NAMES.GITHUB,
        externalId: sender.id.toString(),
        organizationId: integrationInstallation.organization.id,
      },
    },
    include: {
      user: true,
    },
  });

  return {
    integrationInstallation,
    organization: integrationInstallation.organization,
    integrationAccount,
    user: integrationAccount?.user,
  };
};

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#push
githubWebhooks.on('push', async ({ id, name, payload }) => {
  console.log('push callback', { id, name, payload });

  const webhook = await saveIncomingWebhook({
    id,
    event: name,
    source: INTEGRATION_NAMES.GITHUB,
    payload,
  });

  const { commits, repository, sender } = payload;
  const { integrationInstallation, user } = await getAccountsForWebhook(payload, webhook);

  // Get the details of each commit
  // https://docs.github.com/en/rest/commits/commits?apiVersion=2022-11-28#get-a-commit
  const commitDetails = await Promise.all(
    commits.map(async (commit) => {
      const repoDetails = await githubApiRequestWithRetry(
        integrationInstallation,
        'GET /repos/{owner}/{repo}/commits/{ref}',
        {
          owner: repository.owner.login,
          repo: repository.name,
          ref: commit.id,
        }
      );
      return repoDetails.data;
    })
  );

  // Store the activity
  await saveActvity({
    userId: user?.id,
    organizationId: integrationInstallation.organizationId as string,
    eventData: {
      event: name,
      commits,
      commitDetails,
      repository,
      sender,
    },
  });

  // Mark the webhook as processed
  await prisma.incomingWebhook.update({
    where: {
      id: webhook.id,
    },
    data: {
      proceessedAt: new Date(),
    },
  });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request
githubWebhooks.on('pull_request', async ({ id, name, payload }) => {
  console.log('pull_request callback', { id, name, payload });

  const { action, sender, pull_request: pullRequest, repository } = payload;

  if (
    ![
      'closed',
      'edited',
      'opened',
      'read_for_review',
      'reopened',
      'review_requested',
      'assigned',
    ].includes(action)
  ) {
    logger.info('Unsupported action for pull_request', action, { structuredData: true });
    return;
  }

  const webhook = await saveIncomingWebhook({
    id,
    event: name,
    source: INTEGRATION_NAMES.GITHUB,
    payload,
  });

  const { integrationInstallation, user } = await getAccountsForWebhook(payload, webhook);

  // Store the activity
  await saveActvity({
    userId: user?.id,
    organizationId: integrationInstallation.organizationId as string,
    eventData: {
      event: name,
      action,
      pullRequest,
      repository,
      sender,
    },
  });

  await prisma.incomingWebhook.update({
    where: {
      id: webhook.id,
    },
    data: {
      proceessedAt: new Date(),
    },
  });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request_review_comment
githubWebhooks.on('pull_request_review_comment', async ({ id, name, payload }) => {
  console.log('pull_request_review_comment callback', { id, name, payload });
  const { action, sender, pull_request: pullRequest, repository, comment } = payload;

  if (!['created', 'edited'].includes(action)) {
    logger.info('Unsupported action for pull_request_review_comment', action, {
      structuredData: true,
    });
    return;
  }

  const webhook = await saveIncomingWebhook({
    id,
    event: name,
    source: INTEGRATION_NAMES.GITHUB,
    payload,
  });
  const { integrationInstallation, user } = await getAccountsForWebhook(payload, webhook);

  // Store the activity
  await saveActvity({
    userId: user?.id,
    organizationId: integrationInstallation.organizationId as string,
    eventData: {
      event: name,
      action,
      pullRequest,
      repository,
      comment,
      sender,
    },
  });

  await prisma.incomingWebhook.update({
    where: {
      id: webhook.id,
    },
    data: {
      proceessedAt: new Date(),
    },
  });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request_review
githubWebhooks.on('pull_request_review', async ({ id, name, payload }) => {
  console.log('pull_request_review callback', { id, name, payload });
  const { action, sender, pull_request: pullRequest, repository, review } = payload;

  const webhook = await saveIncomingWebhook({
    id,
    event: name,
    source: INTEGRATION_NAMES.GITHUB,
    payload,
  });
  const { integrationInstallation, user } = await getAccountsForWebhook(payload, webhook);

  // Store the activity
  await saveActvity({
    userId: user?.id,
    organizationId: integrationInstallation.organizationId as string,
    eventData: {
      event: name,
      action,
      pullRequest,
      repository,
      review,
      sender,
    },
  });

  await prisma.incomingWebhook.update({
    where: {
      id: webhook.id,
    },
    data: {
      proceessedAt: new Date(),
    },
  });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request_review_thread
githubWebhooks.on('pull_request_review_thread', async ({ id, name, payload }) => {
  console.log('pull_request_review_thread callback', { id, name, payload });
  const { action, sender, pull_request: pullRequest, repository, thread } = payload;

  const webhook = await saveIncomingWebhook({
    id,
    event: name,
    source: INTEGRATION_NAMES.GITHUB,
    payload,
  });

  const { integrationInstallation, user } = await getAccountsForWebhook(payload, webhook);

  // Store the activity
  await saveActvity({
    userId: user?.id,
    organizationId: integrationInstallation.organizationId as string,
    eventData: {
      event: name,
      action,
      pullRequest,
      thread,
      repository,
      sender,
    },
  });

  await prisma.incomingWebhook.update({
    where: {
      id: webhook.id,
    },
    data: {
      proceessedAt: new Date(),
    },
  });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#release
githubWebhooks.on('release', async ({ id, name, payload }) => {
  console.log('release callback', { id, name, payload });
  const { action, sender, repository, release } = payload;

  const webhook = await saveIncomingWebhook({
    id,
    event: name,
    source: INTEGRATION_NAMES.GITHUB,
    payload,
  });
  const { integrationInstallation, user } = await getAccountsForWebhook(payload, webhook);

  // Store the activity
  await saveActvity({
    userId: user?.id,
    organizationId: integrationInstallation.organizationId as string,
    eventData: {
      event: name,
      action,
      release,
      repository,
      sender,
    },
  });

  await prisma.incomingWebhook.update({
    where: {
      id: webhook.id,
    },
    data: {
      proceessedAt: new Date(),
    },
  });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#issue_comment
githubWebhooks.on('issue_comment', async ({ id, name, payload }) => {
  console.log('issue_comment callback', { id, name, payload });
  const { action, sender, repository, issue, comment } = payload;

  const webhook = await saveIncomingWebhook({
    id,
    event: name,
    source: INTEGRATION_NAMES.GITHUB,
    payload,
  });
  const { integrationInstallation, user } = await getAccountsForWebhook(payload, webhook);

  // Store the activity
  await saveActvity({
    userId: user?.id,
    organizationId: integrationInstallation.organizationId as string,
    eventData: {
      event: name,
      action,
      issue,
      comment,
      repository,
      sender,
    },
  });

  await prisma.incomingWebhook.update({
    where: {
      id: webhook.id,
    },
    data: {
      proceessedAt: new Date(),
    },
  });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#issues
githubWebhooks.on('issues', async ({ id, name, payload }) => {
  console.log('issues callback', { id, name, payload });
  const { action, sender, repository, issue } = payload;

  const webhook = await saveIncomingWebhook({
    id,
    event: name,
    source: INTEGRATION_NAMES.GITHUB,
    payload,
  });
  const { integrationInstallation, user } = await getAccountsForWebhook(payload, webhook);

  // Store the activity
  await saveActvity({
    userId: user?.id,
    organizationId: integrationInstallation.organizationId as string,
    eventData: {
      event: name,
      action,
      issue,
      repository,
      sender,
    },
  });

  await prisma.incomingWebhook.update({
    where: {
      id: webhook.id,
    },
    data: {
      proceessedAt: new Date(),
    },
  });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#commit_comment
githubWebhooks.on('commit_comment', async ({ id, name, payload }) => {
  console.log('commit_comment callback', { id, name, payload });
  const { action, sender, repository, comment } = payload;

  const webhook = await saveIncomingWebhook({
    id,
    event: name,
    source: INTEGRATION_NAMES.GITHUB,
    payload,
  });
  const { integrationInstallation, user } = await getAccountsForWebhook(payload, webhook);

  // Store the activity
  await saveActvity({
    userId: user?.id,
    organizationId: integrationInstallation.organizationId as string,
    eventData: {
      event: name,
      action,
      comment,
      repository,
      sender,
    },
  });

  await prisma.incomingWebhook.update({
    where: {
      id: webhook.id,
    },
    data: {
      proceessedAt: new Date(),
    },
  });
});

export default router;

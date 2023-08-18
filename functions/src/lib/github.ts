import { Config } from '../config';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/core';
import { RequestParameters, OctokitResponse } from '@octokit/types';
import { components } from '@octokit/openapi-types';
import { Installation as GithubIntegrationInstallationData } from '@octokit/webhooks-types';
import fs from 'fs';
import { prisma } from './prisma';
import { IntegrationInstallation } from '@prisma/client';
import * as logger from 'firebase-functions/logger';

const privateKey = fs.readFileSync(Config.GITHUB_PRIVATE_KEY_PATH, 'utf-8');

export const getInstallationAuth = async (installationId: string) => {
  const auth = createAppAuth({
    appId: Config.GITHUB_APP_ID,
    privateKey: privateKey,
    installationId: installationId,
  });
  return await auth({ type: 'installation' });
};

export const saveInstallationAuth = async (
  integrationInstallationId: string,
  githubInstallationId: string
) => {
  return prisma.integrationInstallation.update({
    where: {
      id: integrationInstallationId,
    },
    data: {
      accessToken: (await getInstallationAuth(githubInstallationId)).token,
    },
  });
};

export const githubApiRequestWithRetry = async (
  integrationInstallation: IntegrationInstallation,
  route: string,
  options?: RequestParameters,
  retryCount = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<OctokitResponse<any>> => {
  try {
    const octokit = new Octokit({ auth: integrationInstallation.accessToken });
    const response = await octokit.request(route, options);
    return response;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error.status === 401 && retryCount < 3) {
      integrationInstallation = await saveInstallationAuth(
        integrationInstallation.id,
        (integrationInstallation.data as unknown as GithubIntegrationInstallationData).id.toString()
      );
      return await githubApiRequestWithRetry(
        integrationInstallation,
        route,
        options,
        retryCount + 1
      );
    } else {
      logger.error(error, { structuredData: true });
      throw error;
    }
  }
};

export const getCommitDetailsMessage = (commit: components['schemas']['commit']) => {
  return `Commit: ${commit.sha}
URL: ${commit.url}
Message: ${commit.commit.message}
${
  commit.stats
    ? `Stats: ${commit.stats.additions} additions and ${commit.stats.deletions} deletions`
    : ''
}
${commit.files ? `Changes: ${getFilesChangesMessage(commit.files)}` : ''}`;
};

export const getFilesChangesMessage = (files: components['schemas']['commit']['files']) => {
  return files?.map((file) => {
    return `
Filename: ${file.filename}
Stats: ${file.changes} changes, ${file.additions} additions and ${file.deletions} deletions
Code changes: "${file.patch}"`;
  });
};

export const getPullRequestDetailsMessage = (
  pullRequest: components['schemas']['pull-request']
) => {
  return `Pull Request: #${pullRequest.number} - ${pullRequest.title}
State: ${pullRequest.state}
URL: ${pullRequest.html_url}
Body: ${pullRequest.body}
${
  pullRequest.merged
    ? `Merged at: ${pullRequest.merged_at}
Merged by: ${pullRequest.merged_by?.login}`
    : ''
}
${pullRequest.commits ? `Commits: ${pullRequest.commits}` : ''}
${pullRequest.additions ? `Additions: ${pullRequest.additions}` : ''}
${pullRequest.deletions ? `Deletions: ${pullRequest.deletions}` : ''}
${pullRequest.changed_files ? `Changed files: ${pullRequest.changed_files}` : ''}
${
  pullRequest.requested_reviewers?.length
    ? `Requested reviewers: ${pullRequest.requested_reviewers
        .map((reviewer) => reviewer.login)
        .join(', ')}`
    : ''
}`;
};

export const getPullRequestCommentDetailsMessage = (
  pullRequestComment: components['schemas']['pull-request-review-comment']
) => {
  return `Pull Request Comment:
URL: ${pullRequestComment.html_url}
Comment: ${pullRequestComment.body}
${pullRequestComment.user ? `By: ${pullRequestComment.user.login}` : ''}`;
};

export const getPullRequestReviewDetailsMessage = (
  pullRequestReview: components['schemas']['pull-request-review']
) => {
  return `Pull Request Review: ${pullRequestReview.id}
URL: ${pullRequestReview.html_url}
State: ${pullRequestReview.state}
Body: ${pullRequestReview.body}
${pullRequestReview.user ? `By: ${pullRequestReview.user.login}` : ''}`;
};

export const getReleaseDetailsMessage = (release: components['schemas']['release']) => {
  return `Release: ${release.name}
URL: ${release.html_url}
Tag: ${release.tag_name}
Body: ${release.body}
${release.author ? `Author: ${release.author.login}` : ''}`;
};

export const getIssueDetailsMessage = (issue: components['schemas']['issue']) => {
  return `Issue: #${issue.number} - ${issue.title}
State: ${issue.state}
URL: ${issue.html_url}
Body: ${issue.body}
${issue.user ? `Created By: ${issue.user.login}` : ''}`;
};

export const getIssueCommentDetailsMessage = (
  issue: components['schemas']['issue'],
  issueComment: components['schemas']['issue-comment']
) => {
  return `Issue: #${issue.number} - ${issue.title}
Body: ${issue.body}
Comment: ${issueComment.body}
${issueComment.user ? `By: ${issueComment.user.login}` : ''}`;
};

export const getCommitCommentDetailsMessage = (
  commitComment: components['schemas']['commit-comment']
) => {
  return `Commit Comment:
URL: ${commitComment.html_url}
Line: ${commitComment.line}
Commit: ${commitComment.commit_id}
Comment: ${commitComment.body}
${commitComment.user ? `By: ${commitComment.user.login}` : ''}`;
};

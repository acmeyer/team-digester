export interface User {
  id: string;
  slackId: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  organizations?: string[];
  pictureUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Organization {
  id: string;
  name?: string;
  slackId?: string;
  isSlackEnterprise?: boolean;
  teams?: Team[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Team {
  id: string;
  name?: string;
  members?: User[];
  createdAt: Date;
  updatedAt: Date;
}

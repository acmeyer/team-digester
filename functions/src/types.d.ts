import {
  Organization,
  IntegrationAccount,
  User,
  Team,
  TeamMembership,
  NotificationSetting,
  IntegrationInstallation,
} from '@prisma/client';
import { Option } from '@slack/bolt';

export interface OauthStateStore {
  organizationId?: string;
  userId: string;
  installationId?: string;
}

export interface OrganizationWithIntegrationAccounts extends Organization {
  integrationAccounts: IntegrationAccount[];
}

export interface OrganizationWithIntegrationAccountsAndInstallations extends Organization {
  integrationAccounts: IntegrationAccount[];
  integrationInstallations: IntegrationInstallation[];
}

export interface OrganizationWithTeams extends Organization {
  teams: TeamWithMembers[];
}

export interface TeamWithMembers extends Team {
  members: TeamMembershipWithUser[];
}

export interface OrganizationWithintegrationAccountsAndTeams
  extends OrganizationWithIntegrationAccounts {
  teams: Team[];
}

export interface TeamMembershipWithTeam extends TeamMembership {
  team: TeamWithMembers;
}

export interface UserWithTeams extends User {
  teamMemberships: TeamMembershipWithTeam[];
}

export interface TeamMembershipWithUser extends TeamMembership {
  user: User;
}

export interface UserWithNotificationSettings extends User {
  notificationSettings: NotificationSetting[];
}

export type NotificationSettingsState = {
  values: {
    notification_frequency: {
      notification_frequency: { type: string; selected_options: Option[] };
    };
    daily_hour?: {
      notification_timing: { type: string; selected_option: Option };
    };
    weekly_hour?: {
      notification_timing: { type: string; selected_option: Option };
    };
    weekly_dayOfWeek?: {
      notification_timing: { type: string; selected_option: Option };
    };
    monthly_hour?: {
      notification_timing: { type: string; selected_option: Option };
    };
    monthly_dayOfMonth?: {
      notification_timing: { type: string; selected_option: Option };
    };
  };
};

export type Timing = {
  notification_timing: { type: string; selected_option: Option };
};

export type GroupedOptions = {
  daily: { hour?: string };
  weekly: { hour?: string; dayOfWeek?: string };
  monthly: { hour?: string; dayOfMonth?: string };
};

export type GitHubUsernameSelectState = {
  values: {
    connect_github: {
      github_username_select: { type: string; selected_option: Option };
    };
  };
};

export type TeamFormState = {
  values: {
    team_name: { team_name: { type: string; value: string } };
    team_members: {
      team_members_select: { type: string; selected_users: string[] };
    };
  };
};

export type TeamFormValues = TeamFormState['values'];

export type NotificationTimingValues = {
  daily?: { hour: number; hourUTC: number };
  weekly?: { hour: number; hourUTC: number; dayOfWeek: number; dayOfWeekUTC: number };
  monthly?: { hour: number; hourUTC: number; dayOfMonth: number; dayOfMonthUTC: number };
};

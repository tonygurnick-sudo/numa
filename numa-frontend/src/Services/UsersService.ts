export type WorkspaceUser = {
  sub?: string;
  email: string;
  name: string;
  displayName?: string;
  jobTitle?: string;
  profileImage?: { s3Bucket: string; s3Key: string } | null;
  avatarUrl?: string;
  enabled: boolean;
};

type NumaGet = (url: string, params?: Record<string, unknown>) => Promise<unknown>;

export const UsersService = {
  list: async (numaGet: NumaGet): Promise<WorkspaceUser[]> => {
    const response = (await numaGet('/api/users')) as { users?: WorkspaceUser[] };
    return response?.users ?? [];
  },
};

export type WorkspaceUser = {
  email: string;
  name: string;
  enabled: boolean;
};

type NumaGet = (url: string, params?: Record<string, unknown>) => Promise<unknown>;

export const UsersService = {
  list: async (numaGet: NumaGet): Promise<WorkspaceUser[]> => {
    const response = (await numaGet('/api/users')) as { users?: WorkspaceUser[] };
    return response?.users ?? [];
  },
};

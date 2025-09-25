import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  ListUsersCommand,
  AdminSetUserPasswordCommand,
  DescribeUserPoolCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider'
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers'
import { authService } from './authService'

export interface User {
  username: string
  email: string
  enabled: boolean
  status: string
  created: Date
}

export interface ListUsersResult {
  users: User[]
  nextToken?: string
  hasMore: boolean
}

function genPassword(length = 16): string {
  const classes = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789', '!@#$%']
  let password = ''

  const randomValues = new Uint8Array(32)
  window.crypto.getRandomValues(randomValues)
  for (let i = 0; i < length; i++) {
    const chars = classes[i % classes.length]
    password += chars.charAt(randomValues[i] % chars.length)
  }
  return password
}

export class UserManagementService {
  private userPoolId: string
  private region: string
  private identityPoolId: string
  private providerName: string

  constructor(region: string, identityPoolId: string, userPoolId: string) {
    this.region = region
    this.identityPoolId = identityPoolId
    this.userPoolId = userPoolId
    this.providerName = `cognito-idp.${region}.amazonaws.com/${userPoolId}`
  }

  private getCredentialsProvider() {
    return async () => {
      const ensured = await authService.ensureValidSession(60 * 1000)
      const session = ensured || authService.getCurrentSession()
      if (!session) throw new Error('Not authenticated')
      const base = fromCognitoIdentityPool({
        identityPoolId: this.identityPoolId,
        logins: {
          [this.providerName]: session.idToken,
        },
        clientConfig: { region: this.region },
      })
      return base()
    }
  }

  private getClient(): CognitoIdentityProviderClient {
    return new CognitoIdentityProviderClient({
      region: this.region,
      credentials: this.getCredentialsProvider(),
    })
  }

  async createUser(email: string): Promise<{ user: UserType }> {
    try {
      const lowercaseEmail = email.toLowerCase()

      const command = new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        Username: lowercaseEmail,
        TemporaryPassword: genPassword(),
        UserAttributes: [
          {
            Name: 'email',
            Value: lowercaseEmail,
          },
          {
            Name: 'email_verified',
            Value: 'true',
          },
        ],
        MessageAction: 'SUPPRESS',
      })

      const response = await this.getClient().send(command)

      const passwordCommand = new AdminSetUserPasswordCommand({
        UserPoolId: this.userPoolId,
        Username: lowercaseEmail,
        Password: genPassword(),
        Permanent: true,
      })

      await this.getClient().send(passwordCommand)

      return {
        user: response.User,
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'UsernameExistsException') {
        throw new Error('A user with this email already exists')
      }
      throw error
    }
  }

  async listUsers(limit = 20, paginationToken?: string): Promise<ListUsersResult> {
    try {
      const command = new ListUsersCommand({
        UserPoolId: this.userPoolId,
        Limit: Math.min(Math.max(limit, 1), 60),
        ...(paginationToken && { PaginationToken: paginationToken }),
      })

      const response = await this.getClient().send(command)

      const users: User[] = (response.Users || []).map((user) => ({
        username: user.Username!,
        email: user.Attributes?.find((attr) => attr.Name === 'email')?.Value || '',
        enabled: user.Enabled || false,
        status: user.UserStatus || 'UNKNOWN',
        created: user.UserCreateDate || new Date(),
      }))

      return {
        users,
        nextToken: response.PaginationToken,
        hasMore: !!response.PaginationToken,
      }
    } catch (error) {
      console.error('Error fetching users:', error)
      throw error
    }
  }

  async deleteUser(username: string): Promise<void> {
    try {
      const getCognitoCommand = new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
      })
      await this.getClient().send(getCognitoCommand)

      const deleteCognitoCommand = new AdminDeleteUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
      })
      await this.getClient().send(deleteCognitoCommand)
    } catch (error: unknown) {
      if (error.name === 'UserNotFoundException') {
        console.warn(`User ${username} not found, skipping deletion`)
        return
      }
      console.error(`Error deleting user ${username}:`, error)
      throw error
    }
  }

  async describeUserPool(): Promise<{ estimatedNumberOfUsers: number }> {
    try {
      const command = new DescribeUserPoolCommand({
        UserPoolId: this.userPoolId,
      })

      const response = await this.getClient().send(command)
      return {
        estimatedNumberOfUsers: response.UserPool?.EstimatedNumberOfUsers || 0,
      }
    } catch (error) {
      console.error('Error describing user pool:', error)
      throw error
    }
  }
}

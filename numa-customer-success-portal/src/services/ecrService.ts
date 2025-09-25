import {
  ECRClient,
  DescribeImagesCommand,
  ImageDetail
} from '@aws-sdk/client-ecr'
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers'
import { ECRImage } from '@/types'
import { getConfigValue } from './configService'
import { authService } from './authService'

export class ECRService {
  private repositoryName = 'numa-deploy'  // Matches GitLab CI: ECR_REPO: ${ECR_BASE}/numa-deploy
  private cachedImages: ECRImage[] = []
  private lastFetchTime: number = 0
  private readonly cacheDuration = 10 * 60 * 1000 // 10 minutes

  constructor() {}

  private getCredentialsProvider() {
    // Return a provider that ensures valid tokens before resolving credentials
    if (!this.isInBrowser() || !this.hasCognitoConfig()) return undefined

    const region = getConfigValue('AWS_REGION') || 'us-east-1'
    const identityPoolId = getConfigValue('IDENTITY_POOL_ID')!
    const userPoolId = getConfigValue('USER_POOL_ID')!

    return async () => {
      const ensured = await authService.ensureValidSession(60 * 1000)
      const session = ensured || authService.getCurrentSession()
      if (!session) throw new Error('Not authenticated')
      const idToken = session.idToken

      const base = fromCognitoIdentityPool({
        identityPoolId,
        logins: {
          [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: idToken,
        },
        clientConfig: { region },
      })
      return base()
    }
  }

  private isInBrowser(): boolean {
    return typeof window !== 'undefined'
  }

  private hasCognitoConfig(): boolean {
    return !!(getConfigValue('IDENTITY_POOL_ID') && getConfigValue('USER_POOL_ID'))
  }

  async getAllImages(): Promise<ECRImage[]> {
    const now = Date.now()
    if (this.cachedImages.length > 0 && now - this.lastFetchTime < this.cacheDuration) {
      return this.cachedImages
    }

    try {
      const ecrRegion = getConfigValue('ECR_REGION') || getConfigValue('AWS_REGION') || 'us-east-1'
      const ecrClient = new ECRClient({
        region: ecrRegion,
        credentials: this.getCredentialsProvider(),
      })
      const registryId = getConfigValue('ECR_REGISTRY_ID') || undefined
      const response = await ecrClient.send(
        new DescribeImagesCommand({
          repositoryName: this.repositoryName,
          registryId,
          maxResults: 100,
          imageDetails: true,
        })
      )

      if (!response.imageDetails) {
        return []
      }

      this.cachedImages = this.mapImageDetailsToECRImages(response.imageDetails)
      this.lastFetchTime = now

      return this.cachedImages
    } catch (error) {
      console.error('Failed to fetch ECR images:', error)

      // Return empty array when ECR is not accessible - no mock data
      throw error
    }
  }

  private mapImageDetailsToECRImages(imageDetails: ImageDetail[]): ECRImage[] {
    return imageDetails
      .filter(image => image.imageTags && image.imageTags.length > 0)
      .map(image => ({
        repository: this.repositoryName,
        tag: image.imageTags![0], // Use first tag
        digest: image.imageDigest || 'sha256:unknown',
        pushedAt: image.imagePushedAt?.toISOString() || new Date().toISOString(),
        sizeMb: Math.round((image.imageSizeInBytes || 0) / (1024 * 1024)),
        gitCommit: this.extractGitCommitFromTag(image.imageTags![0]),
        gitBranch: this.extractBranchFromTag(image.imageTags![0]),
      }))
      .sort((a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime())
  }

  private extractGitCommitFromTag(tag: string): string {
    // GitLab CI pushes images with short SHA as tag (e.g., "abc123de")
    if (/^[a-f0-9]{8}$/.test(tag)) {
      return tag
    }
    return 'unknown'
  }

  private extractBranchFromTag(tag: string): string {
    if (tag === 'latest') return 'main'
    if (tag.startsWith('v')) return 'main' // Version tags usually from main
    if (tag.includes('hotfix')) return 'hotfix'
    return 'feature'
  }


  async getImagesByTag(tags: string[]): Promise<ECRImage[]> {
    const allImages = await this.getAllImages()
    return allImages.filter(image => tags.includes(image.tag))
  }

  async getLatestImage(): Promise<ECRImage | undefined> {
    const allImages = await this.getAllImages()
    return allImages.find(image => image.tag === 'latest') || allImages[0]
  }

  clearCache(): void {
    this.cachedImages = []
    this.lastFetchTime = 0
  }
}

export const ecrService = new ECRService()

import { ECRClient, DescribeImagesCommand, ImageDetail } from '@aws-sdk/client-ecr';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { ECRImage } from '@/types';
import { getConfigValue } from './configService';
import { authService } from './authService';
import { getAllImageMetadata, type ImageMetadata, type RepositoryName } from './imageTagService';

export class ECRService {
  private repositoryName: RepositoryName;
  private cachedImages: ECRImage[] = [];
  private lastFetchTime: number = 0;
  private readonly cacheDuration = 10 * 60 * 1000; // 10 minutes

  constructor(repositoryName: RepositoryName) {
    this.repositoryName = repositoryName;
  }

  private getCredentialsProvider() {
    if (!this.isInBrowser() || !this.hasCognitoConfig()) return undefined;

    const region = getConfigValue('AWS_REGION') || 'us-east-1';
    const identityPoolId = getConfigValue('IDENTITY_POOL_ID')!;
    const userPoolId = getConfigValue('USER_POOL_ID')!;

    return async () => {
      const ensured = await authService.ensureValidSession(60 * 1000);
      const session = ensured || authService.getCurrentSession();
      if (!session) throw new Error('Not authenticated');
      const idToken = session.idToken;

      const base = fromCognitoIdentityPool({
        identityPoolId,
        logins: {
          [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: idToken,
        },
        clientConfig: { region },
      });
      return base();
    };
  }

  private isInBrowser(): boolean {
    return typeof window !== 'undefined';
  }

  private hasCognitoConfig(): boolean {
    return !!(getConfigValue('IDENTITY_POOL_ID') && getConfigValue('USER_POOL_ID'));
  }

  async getAllImages(): Promise<ECRImage[]> {
    const now = Date.now();
    if (this.cachedImages.length > 0 && now - this.lastFetchTime < this.cacheDuration) {
      return this.cachedImages;
    }

    try {
      const ecrRegion = getConfigValue('ECR_REGION') || getConfigValue('AWS_REGION') || 'us-east-1';
      const ecrClient = new ECRClient({
        region: ecrRegion,
        credentials: this.getCredentialsProvider(),
      });
      const registryId = getConfigValue('ECR_REGISTRY_ID') || undefined;

      const allImageDetails: ImageDetail[] = [];
      let nextToken: string | undefined;

      do {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
          const response = await ecrClient.send(
            new DescribeImagesCommand({
              repositoryName: this.repositoryName,
              registryId,
              maxResults: 100,
              nextToken,
            }),
            { abortSignal: controller.signal }
          );

          if (response.imageDetails) {
            allImageDetails.push(...response.imageDetails);
          }
          nextToken = response.nextToken;
        } finally {
          clearTimeout(timeoutId);
        }
      } while (nextToken);

      if (allImageDetails.length === 0) {
        this.cachedImages = [];
        this.lastFetchTime = now;
        return [];
      }

      // Metadata table is shared across repos; filter to this repo only.
      const allMetadata = await getAllImageMetadata();
      const metadataMap = new Map<string, ImageMetadata>();
      allMetadata
        .filter((m) => m.repository === this.repositoryName)
        .forEach((meta) => metadataMap.set(`${meta.imageTag}:${meta.digest}`, meta));

      this.cachedImages = this.mapImageDetailsToECRImages(allImageDetails, metadataMap);
      this.lastFetchTime = now;

      return this.cachedImages;
    } catch (error) {
      console.error(`Failed to fetch ECR images for ${this.repositoryName}:`, error);
      throw error;
    }
  }

  private mapImageDetailsToECRImages(
    imageDetails: ImageDetail[],
    metadataMap?: Map<string, ImageMetadata>
  ): ECRImage[] {
    return imageDetails
      .filter((image) => image.imageTags && image.imageTags.length > 0)
      .map((image) => {
        const tag = image.imageTags![0];
        const digest = image.imageDigest || 'sha256:unknown';
        const metadata = metadataMap?.get(`${tag}:${digest}`);

        return {
          repository: this.repositoryName,
          tag,
          digest,
          pushedAt: image.imagePushedAt?.toISOString() || new Date().toISOString(),
          sizeMb: Math.round((image.imageSizeInBytes || 0) / (1024 * 1024)),
          gitCommit: this.extractGitCommitFromTag(tag),
          gitBranch: this.extractBranchFromTag(tag),
          customName: metadata?.customName,
          description: metadata?.description,
        };
      })
      .sort((a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime());
  }

  private extractGitCommitFromTag(tag: string): string {
    if (/^[a-f0-9]{8}$/.test(tag)) {
      return tag;
    }
    return 'unknown';
  }

  private extractBranchFromTag(_tag: string): string {
    // CI now only pushes :${SHA} tags — branch is no longer encoded in the tag.
    // The repository name is the channel marker (numa-deploy = main, numa-deploy-dev = dev/dev-image/*).
    if (this.repositoryName === 'numa-deploy-dev') return 'dev';
    return 'main';
  }

  async getImagesByTag(tags: string[]): Promise<ECRImage[]> {
    const allImages = await this.getAllImages();
    return allImages.filter((image) => tags.includes(image.tag));
  }

  async getLatestImage(): Promise<ECRImage | undefined> {
    // No more :latest tag — most-recent-by-pushedAt is the latest.
    const allImages = await this.getAllImages();
    return allImages[0];
  }

  clearCache(): void {
    this.cachedImages = [];
    this.lastFetchTime = 0;
  }
}

// Singletons per channel
export const prodEcrService = new ECRService('numa-deploy');
export const devEcrService = new ECRService('numa-deploy-dev');

// Backwards compat: existing imports of `ecrService` still work and point at prod.
export const ecrService = prodEcrService;

export function getEcrService(repository: RepositoryName): ECRService {
  return repository === 'numa-deploy-dev' ? devEcrService : prodEcrService;
}

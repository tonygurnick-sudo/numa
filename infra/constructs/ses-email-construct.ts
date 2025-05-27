import { Construct } from 'constructs';
import { SesDomainIdentity } from '@cdktf/provider-aws/lib/ses-domain-identity';
import { SesDomainDkim } from '@cdktf/provider-aws/lib/ses-domain-dkim';
import { SesDomainMailFrom } from '@cdktf/provider-aws/lib/ses-domain-mail-from';
import { SesEmailIdentity } from '@cdktf/provider-aws/lib/ses-email-identity';
import { SesIdentityPolicy } from '@cdktf/provider-aws/lib/ses-identity-policy';
import { SesConfigurationSet } from '@cdktf/provider-aws/lib/ses-configuration-set';
import { TerraformOutput } from 'cdktf';

export interface SesEmailConfigProps {
  /**
   * Domain name for SES domain identity (e.g., arcanum.ai)
   */
  domainName?: string;

  /**
   * Email addresses to verify
   */
  emailAddresses: string[];

  /**
   * Optional mail from domain
   */
  mailFromDomain?: string;

  /**
   * Resource name prefix for SES resources
   */
  resourceNamePrefix: string;

  /**
   * Optional configuration set name override
   * If not provided, it will use ${resourceNamePrefix}-config-set
   */
  configurationSetName?: string;
}

/**
 * SES email configuration construct for setting up email sending
 */
export class SesEmailConfig extends Construct {
  public readonly emailIdentities: SesEmailIdentity[] = [];
  public readonly domainIdentity?: SesDomainIdentity;
  public readonly configurationSet: SesConfigurationSet;

  constructor(scope: Construct, name: string, props: SesEmailConfigProps) {
    super(scope, name);

    // Create SES Configuration Set
    const configSetName = props.configurationSetName ?? `${props.resourceNamePrefix}-config-set`;
    this.configurationSet = new SesConfigurationSet(this, 'configuration-set', {
      name: configSetName,
      reputationMetricsEnabled: true,
      sendingEnabled: true,
    });

    // Output Configuration Set Name
    new TerraformOutput(this, 'configuration-set-name', {
      value: this.configurationSet.name,
      description: `Name of the SES configuration set`,
    });

    // Create email identities for all provided email addresses
    props.emailAddresses.forEach((email, index) => {
      const identity = new SesEmailIdentity(this, `email-identity-${index}`, {
        email: email,
      });

      this.emailIdentities.push(identity);

      // Output the ARN and verification status
      new TerraformOutput(this, `email-identity-${index}-arn`, {
        value: identity.arn,
        description: `ARN of the SES email identity for ${email}`,
      });
    });

    // Optionally set up domain identity if domain name is provided
    if (props.domainName) {
      // Set up domain identity
      this.domainIdentity = new SesDomainIdentity(this, 'domain-identity', {
        domain: props.domainName,
      });

      // Output verification token
      new TerraformOutput(this, 'domain-verification-token', {
        value: this.domainIdentity.verificationToken,
        description: `Verification token for domain ${props.domainName}`,
      });

      // Set up DKIM
      const dkim = new SesDomainDkim(this, 'domain-dkim', {
        domain: props.domainName,
      });

      // Output DKIM tokens
      new TerraformOutput(this, 'dkim-tokens', {
        value: dkim.dkimTokens,
        description: `DKIM tokens for domain ${props.domainName}`,
      });

      // Set up mail from domain if provided
      if (props.mailFromDomain) {
        new SesDomainMailFrom(this, 'mail-from', {
          domain: props.domainName,
          mailFromDomain: props.mailFromDomain,
          behaviorOnMxFailure: 'UseDefaultValue',
        });
      }

      // Create a policy that allows sending from this domain
      new SesIdentityPolicy(this, 'identity-policy', {
        identity: this.domainIdentity.domain,
        name: `${props.resourceNamePrefix}-allow-sending`,
        policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['ses:SendEmail', 'ses:SendRawEmail'],
              Resource: this.domainIdentity.arn,
              Principal: {
                Service: 'lambda.amazonaws.com',
              },
            },
          ],
        }),
      });
    }
  }
}

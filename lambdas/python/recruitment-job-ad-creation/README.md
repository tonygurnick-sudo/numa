# Recruitment Job Ad Creation

This Lambda function uses an LLM (specifically, Amazon Bedrock’s Claude 3 model) to generate two variations of a job advertisement (one optimized for **LinkedIn** and one optimized for **SEEK**) as well as **inclusivity suggestions**.

The function:

1. Receives a JSON event containing job-ad context (e.g., job description, tone, etc.) and company information.
2. Sends a prompt to the Claude 3 model, instructing it to generate job ads with specific platform optimizations.
3. Receives a JSON response from the model.
4. Saves the final job-ad content to an S3 bucket as specified by the input event.

---

## Input Schema

The Lambda expects an event with the following top-level keys:

| Key               | Required? | Type   | Description                                                            |
| ----------------- | --------- | ------ | ---------------------------------------------------------------------- |
| `job_ad_context`  | Yes       | Object | An object describing the job ad details.                               |
| `company_profile` | Yes       | Object | An object containing relevant company information.                     |
| `output_bucket`   | Yes       | String | The name of the S3 bucket to which the final job-ad output is written. |
| `output_key`      | Yes       | String | The key (path/filename) within the S3 bucket for the output JSON.      |

### `job_ad_context` Sub-Fields

| Key                              | Required? | Type   | Description                                                              |
| -------------------------------- | --------- | ------ | ------------------------------------------------------------------------ |
| `description_of_job_ad`          | Yes       | String | A description of the job advertisement to be generated.                  |
| `example_job_ads`                | No        | String | Example job advertisements to provide style/tone inspiration (optional). |
| `phrases_or_policies_to_include` | No        | String | Specific phrases/policies that need to be included in the ad (optional). |
| `tone_of_voice`                  | No        | String | Tone of voice to use (default: “professional”).                          |

### `company_profile` Sub-Fields

| Key              | Required? | Type   | Description                                                |
| ---------------- | --------- | ------ | ---------------------------------------------------------- |
| `company_name`   | Yes       | String | The name of the company.                                   |
| `industry`       | No        | String | Industry in which the company operates.                    |
| `description`    | No        | String | A brief description of the company.                        |
| `company_values` | No        | String | The company’s core values or mission statement (optional). |

---

## Example Input

Below is a sample event JSON you might pass to this Lambda:

```json
{
  "job_ad_context": {
    "description_of_job_ad": "We are seeking a full-stack developer to join our growing team...",
    "example_job_ads": "Previous ads that reflect our casual yet professional style...",
    "phrases_or_policies_to_include": "We strongly encourage applications from diverse backgrounds...",
    "tone_of_voice": "inviting"
  },
  "company_profile": {
    "company_name": "Arcanum AI",
    "industry": "Artificial Intelligence",
    "description": "AI solutions provider...",
    "company_values": "Innovative, Inclusive..."
  },
  "output_bucket": "my-job-ad-bucket",
  "output_key": "job-ads/developer-position.json"
}
```

---

## Output Schema

The Lambda function writes a JSON file to the specified S3 bucket with the following structure:

| Key           | Type   | Description                            |
| ------------- | ------ | -------------------------------------- |
| `linkedin_ad` | Object | The LinkedIn-optimized job ad content. |
| `seek_ad`     | Object | The SEEK-optimized job ad content.     |

Explanation

- linkedin_variation: The job ad text specifically optimized for a LinkedIn posting.
- seek_variation: The job ad text specifically optimized for a SEEK posting.

The lambda then returns the output bucket and key where the final job ad content is saved.

## Example Output

Example output JSON saved to the specified S3 bucket:

```json
{
  "linkedin_variation": "Join our dynamic Melbourne-based team as a Full-Stack Developer. At ACME Corp, you’ll build intuitive web solutions, collaborate with cross-functional teams, and shape the future of our products. We champion diversity and career growth, offering a hybrid work environment and a culture of innovation and collaboration...",
  "seek_variation": "ACME Corp is seeking a talented Full-Stack Developer to work from our Melbourne HQ. Enjoy a hybrid setup, competitive salary, and the chance to innovate in a fast-growing tech environment. If you value inclusion, creativity, and collaboration, apply today and help us shape the next wave of cutting-edge solutions..."
}
```

Example return value from the Lambda function:

```json
{
  "output_bucket": "my-job-ad-bucket",
  "output_key": "job-ads/developer-position.json"
}
```

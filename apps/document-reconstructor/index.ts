import {
  TextractClient,
  StartDocumentAnalysisCommand,
  GetDocumentAnalysisCommand,
} from "@aws-sdk/client-textract";
import { TextractDocument } from "amazon-textract-response-parser";
import { FeatureType } from "@aws-sdk/client-textract";
import * as path from "path";

const textractClient = new TextractClient({
  region: "us-east-1",
});

// S3 bucket details
const bucketName = "parallel-indexing";

// Start document analysis with Textract
const startDocumentAnalysis = async (
  bucketName: string,
  key: string
): Promise<string> => {
  const params = {
    DocumentLocation: {
      S3Object: {
        Bucket: bucketName,
        Name: key,
      },
    },
    FeatureTypes: [FeatureType.TABLES, FeatureType.FORMS],
  };

  try {
    const command = new StartDocumentAnalysisCommand(params);
    const data = await textractClient.send(command);
    return data.JobId as string;
  } catch (err) {
    console.error("Error starting document analysis:", err);
    throw err;
  }
};

// Poll for the status of the Textract job
const pollTextractJob = async (jobId: string): Promise<any> => {
  let jobStatus: string | null = null;
  let retries = 0;
  const maxRetries = 20;

  while (retries < maxRetries) {
    console.log(`Polling attempt ${retries + 1} for Textract job ${jobId}`);

    const command = new GetDocumentAnalysisCommand({ JobId: jobId });

    try {
      const data = await textractClient.send(command);
      jobStatus = data.JobStatus as string;

      if (jobStatus === "SUCCEEDED") {
        return data;
      } else if (jobStatus === "FAILED") {
        throw new Error(`Textract job ${jobId} failed.`);
      }

      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds before polling again
    } catch (err) {
      console.error("Error polling Textract job:", err);
      throw err;
    }

    retries += 1;
  }

  throw new Error(
    `Textract job ${jobId} exceeded the maximum number of retries.`
  );
};

// Get document analysis results with pagination handling
const getDocumentAnalysis = async (jobId: string): Promise<any> => {
  const allBlocks: any[] = [];
  let nextToken: string | null = null;

  do {
    const command = new GetDocumentAnalysisCommand({
      JobId: jobId,
      NextToken: nextToken ?? undefined,
    });
    const data = await textractClient.send(command);

    if (!data.Blocks) {
      throw new Error("Textract response does not contain Blocks");
    }

    allBlocks.push(...data.Blocks);
    nextToken = data.NextToken as string | null;
  } while (nextToken);

  return { Blocks: allBlocks };
};

// Generate the Document and DocumentPage structures
const generateDocumentStructure = (textractData: any, documentName: string) => {
  const doc = new TextractDocument(textractData);
  const documentPages: any[] = [];
  let totalWords = 0;

  for (const page of doc.listPages()) {
    const pageText = page.getTextInReadingOrder();
    const numWords = pageText.split(/\s+/).length;
    totalWords += numWords;

    const documentPage = {
      page_number: page.pageNumber,
      num_words: numWords,
      text: pageText,
    };
    documentPages.push(documentPage);
  }

  const documentStructure = {
    name: documentName,
    num_pages: doc.listPages().length,
    total_num_words: totalWords,
    text: documentPages,
    summary: documentPages.map(page => page.text).join(" ").slice(0, 200), // First 200 characters as summary
  };

  return documentStructure;
};

// Lambda handler
export const handler = async (event: any, context: any): Promise<any> => {
  const s3Key = event.s3Key; // Assuming the S3 file path is passed as 's3Key'
  const documentName = path.basename(s3Key);

  try {
    // Start Textract document analysis
    const jobId = await startDocumentAnalysis(bucketName, s3Key);
    console.log(`Started document analysis, JobId: ${jobId}`);

    // Poll until the Textract job completes
    await pollTextractJob(jobId);
    console.log(
      "Textract job succeeded, fetching all document analysis results..."
    );

    // Fetch all pages of document analysis results
    const documentData = await getDocumentAnalysis(jobId);
    console.log("Document analysis data fetched.");

    // Generate Document structure for response
    const documentStructure = generateDocumentStructure(documentData, documentName);

    // Return the document structure as the response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(documentStructure),
    };
  } catch (err) {
    console.error(`Error processing file ${s3Key}:`, err);
    return {
      statusCode: 500,
      body: `Error processing file: ${(err as Error).message}`,
    };
  }
};

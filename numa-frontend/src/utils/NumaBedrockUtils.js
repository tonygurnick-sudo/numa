// NumaBedrockUtils.js
import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

class NumaBedrockUtils {
  constructor(bedrockClient) {
    this.bedrockClient = bedrockClient;
  }

  /**
   * Generate an image description via Bedrock.
   *
   * @param {string} base64Image - The base64-encoded image data (no `data:` prefix).
   * @param {string} mimeType - The MIME type of the image, e.g. "image/png".
   * @param {string} [modelId] - The Bedrock model ID, defaults to "anthropic.claude-3-haiku-20240307-v1:0".
   * @returns {string} - The text description of the image.
   */
  async getImageDescription(
    base64Image,
    mimeType,
    modelId = "anthropic.claude-3-haiku-20240307-v1:0"
  ) {
    if (!this.bedrockClient) {
      throw new Error("Bedrock client not initialized in NumaBedrockUtils");
    }

    const question_text =
      "Please describe this image in detail, including any relevant objects, people, text, colors, and context.";

    const requestBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType, // e.g. "image/png"
                data: base64Image, // your base64 string
              },
            },
            {
              type: "text",
              text: question_text,
            },
          ],
        },
      ],
    };

    // Encode the request body to Uint8Array
    const encodedBody = new TextEncoder().encode(JSON.stringify(requestBody));

    // Build the InvokeModelCommand input
    const command = new InvokeModelCommand({
      modelId,
      body: encodedBody,
      contentType: "application/json", // Telling Bedrock that we are sending JSON
      accept: "application/json", // Expect JSON back
    });

    // Send the request
    const response = await this.bedrockClient.send(command);

    // response.body is a Uint8Array; decode it to string, then parse as JSON
    const decodedBody = new TextDecoder().decode(response.body);
    const responseJson = JSON.parse(decodedBody);

    console.log("Bedrock response JSON:", responseJson);

    // Extract the final text from responseJson
    let finalText = "";
    const firstBlock = responseJson?.content?.[0];
    if (firstBlock?.type === "text") {
      finalText = firstBlock.text;
    } else {
      // Fallback if no text block found
      finalText = JSON.stringify(responseJson, null, 2);
    }

    return finalText;
  }
}

export { NumaBedrockUtils };

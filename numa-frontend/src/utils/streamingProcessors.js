/**
 * Utility functions for processing streaming chat responses
 * Extracted from NumaChat.jsx to improve maintainability
 */

/**
 * parseChunkWithoutDocComments(chunk, docStripState)
 * - This function is used to strip comments from the assistant response.
 * - Removes everything from <!-- ... --> while preserving newlines/other text.
 * - Replace the comment with '---' for nicer display of the document.
 * - Returns the stripped text.
 * - If a comment tag is split across chunk boundaries, it uses docStripState.leftover
 *   to handle partial tags in the next chunk.
 */
export function parseChunkWithoutDocComments(chunk, docStripState) {
  // Combine leftover from previous chunk with the current chunk
  let text = docStripState.leftover + chunk;
  let output = '';
  let i = 0;

  while (i < text.length) {
    // Find the start of a comment
    const startIndex = text.indexOf('<!--', i);
    if (startIndex === -1) {
      // No more comments in this chunk
      output += text.slice(i);
      i = text.length;
    } else {
      // Add text before the comment to output
      output += text.slice(i, startIndex);

      // Find the end of the comment
      const closeIndex = text.indexOf('-->', startIndex);
      if (closeIndex === -1) {
        // Comment is incomplete in this chunk, save it for the next chunk
        docStripState.leftover = text.slice(startIndex);
        return output;
      } else {
        // Replace the comment with '---'
        output += '---';
        // Skip past the end of the comment
        i = closeIndex + 3; // jump past -->
      }
    }
  }

  // Clear leftover since all comments are processed
  docStripState.leftover = '';
  return output;
}

/**
 * Extract doc info from raw text. If a doc block is found, returns an object:
 * { docTitle, docContent }, else null.
 */
export function extractSingleDocBlock(rawText) {
  const docRegex = /<!--BEGIN_DOC title="(.*?)"-->([\s\S]*?)<!--END_DOC-->/;
  const match = rawText.match(docRegex);
  if (match) {
    return {
      docTitle: match[1],
      docContent: match[2].trim(),
    };
  }
  return null;
}

/**
 * Create a document strip state object for tracking comment parsing across chunks
 */
export function createDocStripState() {
  return { leftover: '' };
}

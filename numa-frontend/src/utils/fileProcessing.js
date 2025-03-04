import mammoth from 'mammoth';
import Papa from "papaparse";
import * as XLSX from 'xlsx';
import { fromBuffer } from 'file-type';

// PDF.js
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf";
import pdfWorker from "pdfjs-dist/build/pdf.worker.js?url";
GlobalWorkerOptions.workerSrc = pdfWorker;

// Additional libs for new file types
import PPTXParser from "pptx-parser";
import { marked } from "marked";

/**
 * Attempt to infer file type from magic bytes.
 * If unknown, returns "unknown".
 */
const detectFileType = async (file) => {
  const buffer = await file.arrayBuffer();
  const detectedType = await fromBuffer(buffer);
  return detectedType?.ext || 'unknown';
};

/**
 * Process a file and return { content, contentType, inferredType }.
 * This covers:
 * - pdf, docx, txt, csv, xlsx, images (jpg, jpeg, png, gif, webp), pptx, json, html, md
 */
export const processFile = async (file, fileType, numaChatBedrockUtils) => {
  let inferredType = fileType?.toLowerCase() || '';
  if (!inferredType) {
    inferredType = await detectFileType(file);
    console.log(`Detected file type: ${inferredType}`);
  }

  try {
    switch (inferredType) {
      case 'pdf':
        const pdfText = await processPDF(file);
        return { content: pdfText, contentType: 'text', inferredType: 'pdf' };

      case 'docx':
        const docxText = await processDocx(file);
        return { content: docxText, contentType: 'text', inferredType: 'docx' };

      case 'txt':
        const textContent = await processText(file);
        return { content: textContent, contentType: 'text', inferredType: 'txt' };

      case 'csv':
        const csvText = await processCSV(file);
        return { content: csvText, contentType: 'text', inferredType: 'csv' };

      case 'xlsx':
        const xlsxData = await processXLSX(file);
        return { content: xlsxData, contentType: 'text', inferredType: 'xlsx' };

      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'webp':
        const imageDescription = await processImage(file, inferredType, numaChatBedrockUtils);
        return {
          content: imageDescription,
          contentType: 'image',
          inferredType: inferredType
        };

      case 'pptx':
        const pptxData = await processPPTX(file);
        return { content: pptxData, contentType: 'text', inferredType: 'pptx' };

      case 'json':
        const jsonData = await processJSON(file);
        return { content: jsonData, contentType: 'application/json', inferredType: 'json' };

      case 'html':
        const htmlText = await processHTML(file);
        return { content: htmlText, contentType: 'text', inferredType: 'html' };

      case 'md':
        const markdownRendered = await processMarkdown(file);
        return { content: markdownRendered, contentType: 'text', inferredType: 'md' };

      default:
        throw new Error(`Unsupported file type: ${inferredType}`);
    }
  } catch (error) {
    console.error('Error processing file:', error);
    throw error;
  }
};

/** ==========  Processing Helpers  ========== **/

// -------- PDF --------
const processPDF = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;

  let allText = '';
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    allText += `\n${pageText}`;
  }
  /// Check if there is content besides whitespaces or new lines
  /// Let allText be a message "No content found in file, possibly a scanned/image based pdf" if there is no content
  if (!allText.trim()) {
    allText = "No content found in file, possibly a scanned/image based pdf.";
  }
  return allText;
};

// -------- DOCX --------
const processDocx = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
};

// -------- TXT --------
const processText = async (file) => {
  return await file.text();
};

// -------- CSV --------
const processCSV = async (file) => {
  const text = await file.text();
  const result = Papa.parse(text, { header: true });
  return JSON.stringify(result.data);
};

// -------- XLSX --------
const processXLSX = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);
  const workbook = XLSX.read(data, { type: 'array' });

  const firstSheetName = workbook.SheetNames[0];
  const firstWorksheet = workbook.Sheets[firstSheetName];
  const sheetJSON = XLSX.utils.sheet_to_json(firstWorksheet, { header: 1 });

  return JSON.stringify(sheetJSON);
};

// -------- Images --------
const convertImageToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const processImage = async (file, inferredType, numaChatBedrockUtils) => {
  try {
    const base64Image = await convertImageToBase64(file);
    const mimeType = `image/${inferredType}`;
    const description = await numaChatBedrockUtils.getImageDescription(
      base64Image,
      mimeType
    );
    return description;
  } catch (error) {
    console.error('Error processing image:', error);
    throw error;
  }
};

// -------- PPTX --------
const processPPTX = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const result = await PPTXParser(arrayBuffer);
  // Convert to JSON string
  return JSON.stringify(result);
};

// -------- JSON --------
const processJSON = async (file) => {
  const text = await file.text();
  const data = JSON.parse(text);
  // Return pretty-printed JSON
  return JSON.stringify(data, null, 2);
};

// -------- HTML --------
const processHTML = async (file) => {
  const text = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/html");
  return doc.body ? doc.body.innerText : "";
};

// -------- Markdown --------
const processMarkdown = async (file) => {
  const text = await file.text();
  return marked(text);
};

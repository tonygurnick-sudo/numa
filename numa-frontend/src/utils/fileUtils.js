// Function to get content type based on file extension
export const getContentType = (fileName) => {
  const extension = fileName.split('.').pop().toLowerCase();
  const contentTypes = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    txt: 'text/plain',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    csv: 'text/csv',
    // Add more mappings as needed
  };
  return contentTypes[extension] || 'application/octet-stream'; // Default to binary if unknown
};

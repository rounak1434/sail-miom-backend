const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');

/**
 * Adds a watermark to a PDF buffer
 * @param {Buffer} pdfBuffer 
 * @param {string} text 
 * @returns {Promise<Buffer>}
 */
const addWatermark = async (pdfBuffer, text = 'SAIL MIOM - INTERNAL USE ONLY') => {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    for (const page of pages) {
      const { width, height } = page.getSize();
      page.drawText(text, {
        x: width / 4,
        y: height / 2,
        size: 50,
        font: helveticaFont,
        color: rgb(0.75, 0.75, 0.75),
        opacity: 0.3,
        rotate: { angle: 45, type: 'degrees' },
      });
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error('Watermark error:', error);
    return pdfBuffer; // Fallback to original if watermarking fails
  }
};

module.exports = { addWatermark };

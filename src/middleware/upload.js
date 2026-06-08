const multer = require('multer');
const multerS3 = require('multer-s3');
const { s3 } = require('../services/s3.service');
const { v4: uuidv4 } = require('uuid');

// Use memory storage for drawings so we can watermark PDFs before uploading to S3
const drawingUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf';
    const isCad = file.originalname.toLowerCase().endsWith('.dwg') || file.originalname.toLowerCase().endsWith('.dxf');
    if (isPdf || isCad) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and CAD files allowed'), false);
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

const attachmentUpload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_S3_BUCKET,
    key: (req, file, cb) => {
      cb(null, `attachments/${uuidv4()}-${file.originalname}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'video/mp4', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only images, videos and PDFs allowed'), false);
    }
  },
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

module.exports = { drawingUpload, attachmentUpload };

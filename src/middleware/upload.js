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

// multer-s3 throws "bucket is required" at construction when AWS_S3_BUCKET is unset.
// Building it unconditionally crashed startup whenever S3 wasn't configured — even
// though S3 is an optional/fail-soft feature. Build the real uploader only when a
// bucket exists; otherwise hand back a stand-in whose middleware returns a clean 503,
// so the app boots and only the upload endpoints degrade.
let attachmentUpload;

if (process.env.AWS_S3_BUCKET) {
  attachmentUpload = multer({
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
} else {
  console.warn('⚠️  attachmentUpload disabled — AWS_S3_BUCKET not set. Complaint photo upload returns 503.');
  const disabled = (req, res) => res.status(503).json({
    success: false,
    message: 'File upload is disabled — AWS S3 is not configured on the server (AWS_S3_BUCKET).'
  });
  // Mirror the multer API surface the routes use.
  attachmentUpload = { array: () => disabled, single: () => disabled, fields: () => disabled, none: () => disabled };
}

module.exports = { drawingUpload, attachmentUpload };

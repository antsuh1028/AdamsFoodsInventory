const multer = require("multer");
const { S3Client } = require("@aws-sdk/client-s3");
const { TextractClient } = require("@aws-sdk/client-textract");

const awsCredentials = {
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
};

const s3Client = new S3Client(awsCredentials);
const textractClient = new TextractClient(awsCredentials);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = { s3Client, textractClient, upload };

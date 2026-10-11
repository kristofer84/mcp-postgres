import fs from "fs";
import path from "path";
import https from "https";
import os from "os";

// AWS RDS Certificate Management
export const AWS_RDS_CERT_URL = "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem";
export const CERT_CACHE_DIR = path.join(os.homedir(), ".aws", "rds-certs");
export const CERT_FILE_PATH = path.join(CERT_CACHE_DIR, "rds-global-bundle.pem");

// Cache for certificate to avoid multiple downloads
let certificateCache = null;

// Abort a stalled download instead of hanging startup
const CERT_DOWNLOAD_TIMEOUT_MS = parseInt(process.env.DB_CERT_DOWNLOAD_TIMEOUT_MS) || 30000;

async function downloadRdsCertificate() {
  return new Promise((resolve, reject) => {
    console.error("Downloading AWS RDS certificate bundle...");

    const file = fs.createWriteStream(CERT_FILE_PATH);
    const request = https.get(AWS_RDS_CERT_URL, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download certificate: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.error("AWS RDS certificate bundle downloaded successfully");
        resolve(CERT_FILE_PATH);
      });
    });

    request.setTimeout(CERT_DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error(`Timed out downloading certificate after ${CERT_DOWNLOAD_TIMEOUT_MS}ms`));
    });

    request.on('error', (err) => {
      fs.unlink(CERT_FILE_PATH, () => { }); // Delete partial file
      reject(err);
    });

    file.on('error', (err) => {
      fs.unlink(CERT_FILE_PATH, () => { }); // Delete partial file
      reject(err);
    });
  });
}

async function ensureRdsCertificate() {
  try {
    // Return cached certificate if available
    if (certificateCache) {
      return certificateCache;
    }

    // Create cache directory if it doesn't exist
    if (!fs.existsSync(CERT_CACHE_DIR)) {
      fs.mkdirSync(CERT_CACHE_DIR, { recursive: true });
    }

    // Check if certificate already exists and is recent (less than 30 days old)
    if (fs.existsSync(CERT_FILE_PATH)) {
      const stats = fs.statSync(CERT_FILE_PATH);
      const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
      const daysRemaining = Math.ceil(30 - ageInDays);

      if (ageInDays < 30) {
        // Verify the cached certificate is valid (not corrupted)
        try {
          const certContent = fs.readFileSync(CERT_FILE_PATH, 'utf8');
          if (certContent.includes('-----BEGIN CERTIFICATE-----') && certContent.includes('-----END CERTIFICATE-----')) {
            console.error(`Using cached AWS RDS certificate bundle (expires in ${daysRemaining} days)`);
            certificateCache = CERT_FILE_PATH;
            return CERT_FILE_PATH;
          } else {
            console.error("Cached certificate appears corrupted, re-downloading...");
          }
        } catch {
          console.error("Failed to read cached certificate, re-downloading...");
        }
      } else {
        console.error(`AWS RDS certificate bundle expired ${Math.ceil(ageInDays - 30)} days ago, re-downloading...`);
      }
    } else {
      console.error("No cached AWS RDS certificate found, downloading...");
    }

    // Download the certificate
    const certPath = await downloadRdsCertificate();
    certificateCache = certPath;
    return certPath;
  } catch (error) {
    console.error("Failed to ensure RDS certificate:", error.message);
    // Return null to fall back to less secure SSL mode
    return null;
  }
}

export function isAwsRdsEndpoint(hostname) {
  return hostname && hostname.includes('.rds.amazonaws.com');
}

// Build SSL configuration for a given sslMode and hostname
export async function buildSslConfig(sslMode, hostname) {
  if (sslMode === 'require') return { rejectUnauthorized: true };
  if (sslMode === 'disable') return false;
  if (sslMode) return true;

  if (isAwsRdsEndpoint(hostname)) {
    try {
      const certPath = await ensureRdsCertificate();
      if (certPath && fs.existsSync(certPath)) {
        console.error(`Auto-configured SSL for AWS RDS endpoint: ${hostname}`);
        return { rejectUnauthorized: true, ca: fs.readFileSync(certPath, 'utf8') };
      }
      console.error(`WARNING: Could not obtain RDS certificate, falling back to unverified SSL for: ${hostname}`);
      return { rejectUnauthorized: false };
    } catch (error) {
      console.error(`WARNING: SSL auto-configuration failed, falling back to unverified SSL: ${error.message}`);
      return { rejectUnauthorized: false };
    }
  }

  return undefined; // No SSL configured
}

export function getCacheStatus() {
  if (!fs.existsSync(CERT_FILE_PATH)) {
    return { exists: false, message: "No certificate cached" };
  }

  const stats = fs.statSync(CERT_FILE_PATH);
  const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
  const daysRemaining = Math.ceil(30 - ageInDays);

  return {
    exists: true,
    ageInDays: Math.ceil(ageInDays),
    daysRemaining: daysRemaining,
    expired: ageInDays >= 30,
    path: CERT_FILE_PATH,
    size: stats.size,
    lastModified: stats.mtime.toISOString(),
    message: ageInDays < 30
      ? `Certificate cached (expires in ${daysRemaining} days)`
      : `Certificate expired ${Math.ceil(ageInDays - 30)} days ago`
  };
}
